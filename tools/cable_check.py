"""Captures CABLE Output via MME (waveIn) and counts dropouts of a 1 kHz tone, without Chromium.

The tone comes from tools/cable_tone.py. A healthy cable gives 0 dropouts;
dozens in half a minute mean: check VB-Cable's settings (Max Latency 7168,
Internal SR equal to the rate of both cable sides).

    py tools/cable_check.py 30 44100   # seconds, rate (as the cable in Windows)
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
FRAMES = RATE // 20  # 50 ms
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


class WAVEINCAPSW(ctypes.Structure):
    _fields_ = [("wMid", wt.WORD), ("wPid", wt.WORD), ("vDriverVersion", wt.UINT),
                ("szPname", wt.WCHAR * 32), ("dwFormats", wt.DWORD), ("wChannels", wt.WORD),
                ("wReserved1", wt.WORD)]


class GlitchCounter:
    """Same as app/src/shared/glitch.js."""

    def __init__(self, frequency, rate, threshold=0.05):
        self.k = 2 * math.cos(2 * math.pi * frequency / rate)
        self.threshold, self.hold = threshold, rate // 10
        self.prev1 = self.prev2 = self.peak = 0.0
        self.cooldown = self.glitches = self.samples = 0

    def process(self, block):
        for x in block:
            self.peak = max(self.peak * 0.99999, abs(x))
            residual = x + self.prev2 - self.k * self.prev1
            if self.cooldown > 0:
                self.cooldown -= 1
            elif self.samples >= 2 and self.peak > 0.01 and abs(residual) > self.threshold * self.peak:
                self.glitches += 1
                self.cooldown = self.hold
            self.prev2, self.prev1 = self.prev1, x
            self.samples += 1


def find_device(part):
    for i in range(winmm.waveInGetNumDevs()):
        caps = WAVEINCAPSW()
        winmm.waveInGetDevCapsW(i, ctypes.byref(caps), ctypes.sizeof(caps))
        if part in caps.szPname:
            return i, caps.szPname
    raise SystemExit(f"no device {part}")


def main():
    seconds = float(sys.argv[1]) if len(sys.argv) > 1 else 30
    dev, name = find_device("CABLE Output")
    fmt = WAVEFORMATEX(1, CH, RATE, RATE * CH * 2, CH * 2, 16, 0)
    hwi = wt.HANDLE()
    rc = winmm.waveInOpen(ctypes.byref(hwi), dev, ctypes.byref(fmt), 0, 0, 0)
    if rc:
        raise SystemExit(f"waveInOpen: {rc}")
    size = FRAMES * CH * 2
    buffers = [ctypes.create_string_buffer(size) for _ in range(8)]
    headers = []
    for buf in buffers:
        hdr = WAVEHDR(ctypes.cast(buf, ctypes.c_void_p), size, 0, 0, 0, 0, None, 0)
        winmm.waveInPrepareHeader(hwi, ctypes.byref(hdr), ctypes.sizeof(hdr))
        winmm.waveInAddBuffer(hwi, ctypes.byref(hdr), ctypes.sizeof(hdr))
        headers.append(hdr)
    winmm.waveInStart(hwi)
    chunks, order, missed = [], 0, 0
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        hdr, buf = headers[order], buffers[order]
        if hdr.dwFlags & WHDR_DONE:
            chunks.append(buf.raw[:hdr.dwBytesRecorded])
            hdr.dwFlags &= ~WHDR_DONE
            winmm.waveInAddBuffer(hwi, ctypes.byref(hdr), ctypes.sizeof(hdr))
            order = (order + 1) % len(headers)
            if all(h.dwFlags & WHDR_DONE for h in headers):
                missed += 1  # every buffer is full: we are not keeping up
        else:
            time.sleep(0.005)
    winmm.waveInReset(hwi)
    for hdr in headers:
        winmm.waveInUnprepareHeader(hwi, ctypes.byref(hdr), ctypes.sizeof(hdr))
    winmm.waveInClose(hwi)

    data = b"".join(chunks)
    left = [s / 32768 for s in struct.unpack(f"<{len(data) // 2}h", data)[0::2]]
    counter = GlitchCounter(1000, RATE)
    counter.process(left[RATE // 2:])  # skip the first 0.5 s
    print(f"{name}: {counter.glitches} dropouts in {counter.samples / RATE:.1f} s, "
          f"peak {max(map(abs, left)):.3f}, queue overruns {missed}", flush=True)


if __name__ == "__main__":
    main()
