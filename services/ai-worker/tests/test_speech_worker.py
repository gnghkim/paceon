import contextlib
import asyncio
import hashlib
import io
import json
import math
import shutil
import struct
import subprocess
import unittest
import urllib.error
import wave
from unittest.mock import patch

from app.worker import Settings, SafeFailure

USER = '11111111-1111-4111-8111-111111111111'
ID = '22222222-2222-4222-8222-222222222222'
DATA = b'RIFF' + b'\0' * 4 + b'WAVEaudio'
FEEDBACK = {'summary': '잘 말했습니다.', 'corrections': [], 'expressions': [], 'nextPrompt': 'Try again.'}


class SpeechTests(unittest.TestCase):
    def worker(self, kind='RECORDING', finish=True, provider=None, data=DATA):
        from app.speech_worker import SpeechWorker
        calls = []
        job = {'id': ID, 'user_id': USER, 'lease_token': 'lease', 'kind': kind,
               'input': {'level': 'EASY', 'topic': 'Daily life'}, 'reference_text': 'I walk.',
               'storage_path': f'{USER}/{ID}/recording', 'file_size': len(data),
               'content_sha256': hashlib.sha256(data).hexdigest()}
        def transport(url, payload, headers, timeout):
            calls.append((url, payload))
            if url.endswith('speech_cleanup_candidates'): return []
            if url.endswith('claim_speech_job'): return job
            if url.endswith('finish_speech_job'): return finish
            if url.endswith('checkpoint_speech_prompt'): return True
            if isinstance(provider, Exception): raise provider
            result = {'sentence': 'I walk.', 'meaning': '나는 걷습니다.'} if kind == 'PROMPT' else FEEDBACK
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(result)}]}]}
        worker = SpeechWorker(Settings(True, 'http://db', 'service', 'secret', 'model'), transport)
        worker.download_audio = lambda path, allow_missing=False: None if allow_missing else data
        worker.transcribe = lambda wav: ' I walk. '
        worker.synthesize = lambda sentence: b'ID3sample'
        worker.upload_audio = lambda path, audio: calls.append(('upload', path))
        return worker, calls, job

    def test_recording_preserves_transcript_and_output_contract(self):
        worker, calls, _ = self.worker()
        with patch('app.speech_worker.decode_audio', return_value=(b'wav', 2.0)):
            self.assertTrue(worker.run_once())
        final = next(p for u, p in calls if u.endswith('finish_speech_job'))
        self.assertEqual(final['p_output'], {'referenceText': 'I walk.', 'originalText': ' I walk. ',
            'feedback': FEEDBACK, 'storagePath': f'{USER}/{ID}/recording', 'mimeType': 'audio/wav', 'durationSeconds': 2.0})
        body = next(p for u, p in calls if u.endswith('/responses'))
        self.assertIn('untrusted', body['instructions'])
        self.assertIn('pronunciation', body['instructions'])

    def test_invalid_oversize_silent_and_short_never_reach_provider(self):
        from app.speech_worker import MAX_BYTES
        for code in ('INVALID_AUDIO', 'AUDIO_SILENT', 'AUDIO_TOO_SHORT', 'AUDIO_TOO_LONG'):
            worker, calls, _ = self.worker()
            with patch('app.speech_worker.decode_audio', side_effect=SafeFailure(code)):
                worker.run_once()
            self.assertFalse(any(u.endswith('/responses') for u, _ in calls))
            self.assertEqual(next(p for u, p in calls if u.endswith('finish_speech_job'))['p_error_code'], code)
        worker, calls, _ = self.worker(data=b'x' * (MAX_BYTES + 1))
        worker.run_once()
        self.assertEqual(next(p for u, p in calls if u.endswith('finish_speech_job'))['p_error_code'], 'FILE_TOO_LARGE')

    def test_prompt_upload_and_stale_lease_do_not_delete_winner(self):
        worker, calls, _ = self.worker('PROMPT', finish=False)
        with patch('app.speech_worker.decode_audio', return_value=(b'wav', 2.0)):
            self.assertFalse(worker.run_once())
        self.assertIn(('upload', f'{USER}/{ID}/sample.mp3'), calls)
        self.assertFalse(any(u == 'delete' for u, _ in calls))
        final = next(p for u, p in calls if u.endswith('finish_speech_job'))
        self.assertEqual(final['p_output']['feedback']['summary'], '나는 걷습니다.')

    def test_failures_do_not_log_transcript_or_provider_errors(self):
        worker, calls, _ = self.worker(provider=RuntimeError('secret private transcript'))
        capture = io.StringIO()
        with contextlib.redirect_stdout(capture), contextlib.redirect_stderr(capture), patch('app.speech_worker.decode_audio', return_value=(b'wav', 2.0)):
            worker.run_once()
        self.assertEqual(capture.getvalue(), '')
        final = next(p for u, p in calls if u.endswith('finish_speech_job'))
        self.assertEqual(final['p_error_code'], 'PROVIDER_ERROR')
        self.assertIsNone(final['p_output'])

    def test_pcm_rejects_silence_short_and_long(self):
        from app.speech_worker import canonical_wav
        for pcm, code in [(b'\0' * 64000, 'AUDIO_SILENT'), (b'\xff\x0f' * 1000, 'AUDIO_TOO_SHORT'), (b'\xff\x0f' * 976000, 'AUDIO_TOO_LONG')]:
            with self.assertRaisesRegex(SafeFailure, code): canonical_wav(pcm)
        wav, duration = canonical_wav(b'\xff\x0f' * 32000)
        self.assertEqual(duration, 2)
        self.assertTrue(wav.startswith(b'RIFF'))

    def test_actual_format_required_before_decoder(self):
        from app.speech_worker import decode_audio
        with self.assertRaisesRegex(SafeFailure, 'INVALID_AUDIO'):
            decode_audio(b'<html>not audio</html>')

    def test_prompt_retry_reuses_checkpoint_and_sample_without_provider(self):
        worker, calls, job = self.worker('PROMPT')
        job['feedback'] = {**FEEDBACK, 'summary': '나는 걷습니다.'}
        worker.download_audio = lambda path, allow_missing=False: b'ID3sample'
        worker.synthesize = lambda text: self.fail('cached prompt must not synthesize')
        with patch('app.speech_worker.decode_audio', return_value=(b'wav', 2.0)):
            self.assertTrue(worker.run_once())
        self.assertFalse(any(u.endswith('/responses') or u == 'upload' for u, _ in calls))

    def test_checkpoint_rejected_prevents_late_upload(self):
        worker, calls, _ = self.worker('PROMPT')
        rpc = worker.rpc
        worker.rpc = lambda name, payload: False if name == 'checkpoint_speech_prompt' else rpc(name, payload)
        worker.synthesize = lambda text: self.fail('stale checkpoint must stop before synthesis')
        worker.run_once()
        self.assertEqual(next(p for u, p in calls if u.endswith('finish_speech_job'))['p_error_code'], 'STALE_LEASE')

    def test_storage_missing_object_400_is_distinct_from_auth_failure(self):
        from app.speech_worker import request_bytes
        for status, expected_missing in [('404', True), ('403', False)]:
            error = urllib.error.HTTPError('http://db', 400, 'safe', {}, io.BytesIO(json.dumps({'statusCode': status, 'error': 'not_found'}).encode()))
            with patch('app.speech_worker.urllib.request.build_opener') as opener:
                opener.return_value.open.side_effect = error
                if expected_missing:
                    self.assertIsNone(request_bytes('http://db', None, {}, allow_missing=True))
                else:
                    with self.assertRaises(SafeFailure): request_bytes('http://db', None, {}, allow_missing=True)

    def test_cleanup_finishes_only_after_successful_storage_delete(self):
        worker, _, _ = self.worker()
        calls = []
        def rpc(name, payload):
            calls.append((name, payload))
            return [{'id': ID, 'storage_path': f'{USER}/{ID}/sample.mp3'}] if name == 'speech_cleanup_candidates' else True
        worker.rpc = rpc
        with patch('app.speech_worker.request_bytes', side_effect=SafeFailure('PROVIDER_ERROR')):
            worker.cleanup()
        self.assertFalse(any(name == 'finish_speech_cleanup' for name, _ in calls))
        with patch('app.speech_worker.request_bytes', return_value=b'[]') as request:
            worker.cleanup()
        self.assertIn(('finish_speech_cleanup', {'p_id': ID}), calls)
        self.assertEqual(request.call_args.args[3], 'DELETE')

    def test_disabled_ai_still_cleans_storage_without_claiming(self):
        worker, calls, _ = self.worker()
        worker.settings = Settings(False, 'http://db', 'service', '', '')
        self.assertFalse(worker.run_once())
        self.assertEqual([url.rsplit('/', 1)[-1] for url, _ in calls], ['speech_cleanup_candidates'])

    def test_lifespan_starts_cleanup_without_ai_key(self):
        from app import main
        async def check():
            settings = Settings(False, 'http://db', 'service', '', '')
            with patch('app.main.Settings.from_env', return_value=settings), patch('app.main.SpeechWorker') as worker, patch('app.main.PdfSettings.from_env') as pdf:
                pdf.return_value.enabled = False
                async with main.lifespan(main.app): worker.assert_called_once_with(settings)
        asyncio.run(check())

    def test_cleanup_failure_does_not_block_other_files_and_batch_is_bounded(self):
        worker, _, _ = self.worker()
        calls = []
        worker.rpc = lambda name, payload: ([{'id': ID, 'storage_path': f'{USER}/{ID}/sample.mp3'}] * 20 if name == 'speech_cleanup_candidates' else calls.append(payload))
        with patch('app.speech_worker.request_bytes', side_effect=[SafeFailure('PROVIDER_ERROR'), b'[]', b'[]']) as request:
            worker.cleanup()
        self.assertEqual(request.call_count, 3)
        self.assertEqual(len(calls), 2)

    def test_decoder_runs_without_credentials_and_has_hard_timeout(self):
        from app.speech_worker import decode_audio
        def decode(command, **options):
            self.assertEqual(options['timeout'], 20)
            self.assertEqual(command[1], '-I')
            self.assertNotIn('OPENAI_API_KEY', options['env'])
            options['stdout'].write(b'\xff\x0f' * 32000)
            return type('Result', (), {'returncode': 0})()
        with patch('app.speech_worker.shutil.which', return_value='/usr/bin/ffmpeg'), patch('app.speech_worker.subprocess.run', side_effect=decode):
            self.assertEqual(decode_audio(DATA)[1], 2)

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is installed in the Docker image')
    def test_real_decoder_formats_duration_silence_and_invalid_container(self):
        from app.speech_worker import decode_audio
        def wav(seconds, silent=False):
            output = io.BytesIO()
            with wave.open(output, 'wb') as stream:
                stream.setnchannels(1)
                stream.setsampwidth(2)
                stream.setframerate(16000)
                stream.writeframes(b'\0\0' * int(seconds*16000) if silent else b''.join(
                    struct.pack('<h', int(6000 * math.sin(index * math.tau * 220 / 16000))) for index in range(int(seconds * 16000))))
            return output.getvalue()
        sample = wav(2)
        self.assertAlmostEqual(decode_audio(sample)[1], 2, places=2)
        for fmt, codec in [('webm', 'libopus'), ('ogg', 'libopus'), ('mp3', 'libmp3lame'), ('mp4', 'aac')]:
            with self.subTest(format=fmt):
                command = [shutil.which('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-c:a', codec]
                if fmt == 'mp4': command += ['-movflags', 'frag_keyframe+empty_moov']
                converted = subprocess.run(command + ['-f', fmt, 'pipe:1'], input=sample, capture_output=True, timeout=20, check=True).stdout
                self.assertAlmostEqual(decode_audio(converted)[1], 2, delta=0.15)
        for data, code in [(wav(2, True), 'AUDIO_SILENT'), (wav(0.1), 'AUDIO_TOO_SHORT'), (wav(61), 'AUDIO_TOO_LONG'), (DATA, 'INVALID_AUDIO')]:
            with self.subTest(code=code), self.assertRaisesRegex(SafeFailure, code): decode_audio(data)
