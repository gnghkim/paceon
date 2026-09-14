"""Isolated, credential-free ffmpeg launcher (Linux resource limits)."""
import os
import sys

if sys.platform != 'win32':
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
    resource.setrlimit(resource.RLIMIT_FSIZE, (2000000, 2000000))
    resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))

binary, source, audio_format = sys.argv[1:]
os.execve(binary, [binary, '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-max_alloc', '67108864', '-threads', '1', '-protocol_whitelist', 'file',
    '-f', audio_format, '-i', source, '-map', '0:a:0', '-vn', '-sn', '-dn',
    '-t', '61', '-ac', '1', '-ar', '16000', '-threads', '1', '-f', 's16le',
    '-acodec', 'pcm_s16le', 'pipe:1'], dict(os.environ))
