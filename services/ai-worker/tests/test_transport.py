"""Polling pays for a TLS handshake on every ask unless the connection is kept."""

import http.client
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.worker import CONNECTION_IDLE_SECONDS, ConnectionPool, SafeFailure, post_json


class CountingServer(ThreadingHTTPServer):
    """Counts accepted sockets, which is what a kept connection actually saves."""

    daemon_threads = True
    connections = 0

    def process_request(self, request, address):
        self.connections += 1
        super().process_request(request, address)


class KeepAlive(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.status = 200
        self.close_after = False
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.requests.append((self.path, payload, dict(self.headers)))
                raw = json.dumps({"ok": True}).encode()
                self.send_response(outer.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                if outer.close_after:
                    self.close_connection = True
                    self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(raw)

        self.server = CountingServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:" + str(self.server.server_port)
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.start()
        self.pool = ConnectionPool()

    def tearDown(self):
        self.pool.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def post(self, path="/rest/v1/rpc/claim_ai_job", payload=None, timeout=5, pool=None):
        return post_json(self.url + path, payload if payload is not None else {}, {"Authorization": "Bearer fixture"},
                         timeout, pool=pool or self.pool)

    def test_polling_again_and_again_costs_one_connection(self):
        for _ in range(5):
            self.assertEqual(self.post(), {"ok": True})
        self.assertEqual(len(self.requests), 5)
        self.assertEqual(self.server.connections, 1, "the connection is kept between polls")

    def test_the_request_still_carries_its_json_body_and_credentials(self):
        self.post(payload={"p_id": "1"})
        path, payload, headers = self.requests[0]
        self.assertEqual(path, "/rest/v1/rpc/claim_ai_job")
        self.assertEqual(payload, {"p_id": "1"})
        self.assertEqual(headers["Authorization"], "Bearer fixture")
        self.assertEqual(headers["Content-Type"], "application/json")

    def test_a_query_string_survives(self):
        self.post(path="/rest/v1/jobs?select=id")
        self.assertEqual(self.requests[0][0], "/rest/v1/jobs?select=id")

    def test_each_host_and_timeout_keeps_its_own_connection(self):
        self.post(timeout=5)
        self.post(timeout=45)
        self.assertEqual(self.server.connections, 2)

    def test_a_connection_left_idle_too_long_is_replaced_rather_than_trusted(self):
        clock = [1000.0]
        pool = ConnectionPool(clock=lambda: clock[0])
        self.post(pool=pool)
        clock[0] += CONNECTION_IDLE_SECONDS + 1
        self.post(pool=pool)
        pool.close()
        self.assertEqual(self.server.connections, 2)

    def test_an_error_answer_is_reported_and_the_connection_dropped(self):
        self.status = 500
        with self.assertRaises(SafeFailure) as failure:
            self.post()
        self.assertEqual(str(failure.exception), "PROVIDER_ERROR")
        self.status = 200
        self.assertEqual(self.post(), {"ok": True})
        self.assertEqual(self.server.connections, 2, "a connection that answered an error is not reused")

    def test_a_server_that_asks_to_close_is_obeyed(self):
        self.close_after = True
        self.post()
        self.assertEqual(self.pool.held(), 0, "a connection the server said it would close is not kept")
        self.close_after = False
        self.assertEqual(self.post(), {"ok": True})
        self.assertEqual(self.server.connections, 2)

    def test_a_connection_that_died_quietly_is_dropped_so_later_polls_recover(self):
        class Dead:
            closed = False

            def request(self, *args, **kwargs):
                raise http.client.RemoteDisconnected("the other side went away")

            def close(self):
                self.closed = True

        dead = Dead()
        pool = ConnectionPool(factory=lambda *key: dead)
        with self.assertRaises(SafeFailure) as failure:
            self.post(pool=pool)
        self.assertEqual(str(failure.exception), "PROVIDER_ERROR")
        self.assertTrue(dead.closed)
        self.assertEqual(pool.held(), 0, "otherwise every later poll would fail on the same corpse")

    def test_two_threads_never_share_one_connection(self):
        done = threading.Barrier(3)

        def poll():
            self.post()
            done.wait(timeout=10)
            self.pool.close()

        threads = [threading.Thread(target=poll) for _ in range(2)]
        for thread in threads:
            thread.start()
        done.wait(timeout=10)
        for thread in threads:
            thread.join()
        self.assertEqual(self.server.connections, 2)

    def test_an_address_that_is_not_http_never_opens_a_socket(self):
        for url in ["ftp://127.0.0.1/x", "not a url", "https://"]:
            with self.assertRaises(SafeFailure) as failure:
                post_json(url, {}, {}, 5, pool=self.pool)
            self.assertEqual(str(failure.exception), "PROVIDER_ERROR", url)


if __name__ == "__main__":
    unittest.main()
