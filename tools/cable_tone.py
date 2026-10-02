"""1 kHz tone into CABLE Input via MME (waveOut), without Chromium.

Companion of tools/cable_check.py: checks whether VB-Cable itself breaks the audio.
A 100 ms buffer holds exactly 100 periods of the 1 kHz tone at any rate that is a
multiple of 10 Hz, so it can be queued again and again without a phase break.
Best use the same rate as the cable in Windows.

    py tools/cable_tone.py 40 44100    # in one terminal: seconds, rate
    py tools/cable_check.py 30 44100   # in another, a couple of seconds later
"""
import ctypes
import ctypes.wintypes as wt
import math
import struct
import sys
import time

winmm = ctypes.WinDLL("winmm")
RATE = int(sys.argv[2]) if len(sys.argv) > 2 else 48000
CH = 2
FRAMES = RATE // 10  # 100 ms
WHDR_DONE = 0x1


class WAVEFORMATEX(ctypes.Structure):
    _fields_ = [("wFormatTag", wt.WORD), ("nChannels", wt.WORD), ("nSamplesPerSec", wt.DWORD),
                ("nAvgBytesPerSec", wt.DWORD), ("nBlockAlign", wt.WORD), ("wBitsPerSample", wt.WORD),
                ("cbSize", wt.WORD)]


class WAVEHDR(ctypes.Structure):
    pass


WAVEHDR._fields_ = [("lpData", ctypes.c_void_p), ("dwBufferLength", wt.DWORD), ("dwBytesRecorded", wt.DWORD),
                    ("dwUser", ctypes.c_size_t), ("dwFlags", wt.DWORD), ("dwLoops", wt.DWORD),
                    ("lpNext", ctypes.POINTER(WAVEHDR)), ("reserved", ctypes.c_size_t)]


class WAVEOUTCAPSW(ctypes.Structure):
    _fields_ = [("wMid", wt.WORD), ("wPid", wt.WORD), ("vDriverVersion", wt.UINT),
                ("szPname", wt.WCHAR * 32), ("dwFormats", wt.DWORD), ("wChannels", wt.WORD),
                ("wReserved1", wt.WORD), ("dwSupport", wt.DWORD)]


def find_device(part):
    for i in range(winmm.waveOutGetNumDevs()):
        caps = WAVEOUTCAPSW()
        winmm.waveOutGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
        if part in caps.szPname:
            return i, caps.szPname
    raise SystemExit(f"no device {part}")


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 40
    dev, name = find_device("CABLE Input")
    fmt = WAVEFORMATEX(1, CH, RATE, RATE * CH * 2, CH * 2, 16, 0)
    hwo = wt.HANDLE()
    rc = winmm.waveOutOpen(ctypes.byref(hwo), dev, ctypes.byref(fmt), 0, 0, 0)
    if rc:
        raise SystemExit(f"waveOutOpen: {rc}")
    samples = [int(0.5 * 32767 * math.sin(2 * math.pi * 1000 * n / RATE)) for n in range(FRAMES)]
    pcm = b"".join(struct.pack("<hh", s, s) for s in samples)
    buffers = [ctypes.create_string_buffer(pcm, len(pcm)) for _ in range(4)]
    headers = []
    for buf in buffers:
        hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_void_p), len(pcm), 0, 0, 0, 0, None, 0)
        winmm.waveOutPrepareHeader(hwo, ctypes.byref(hdr), ctypes.sizeof(hdr))
        winmm.waveOutWrite(hwo, ctypes.byref(hdr), ctypes.sizeof(hdr))
        headers.append(hdr)
    print(f"tone into {name}, {seconds} s", flush=True)
    end = time.monotonic() + seconds
    requeued = 0
    while time.monotonic() < end:
        for hdr in headers:
            if hdr.dwFlags & WHDR_DONE:
                hdr.dwFlags &= ~WHDR_DONE
                winmm.waveOutWrite(hwo, ctypes.byref(hdr), ctypes.sizeof(hdr))
                requeued += 1
        time.sleep(0.01)
    winmm.waveOutReset(hwo)
    for hdr in headers:
        winmm.waveOutUnprepareHeader(hwo, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveOutClose(hwo)
    print(f"buffers requeued: {requeued}", flush=True)


if __name__ == "__main__":
    main()
