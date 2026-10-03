"""Reads the scs-sdk-plugin shared memory (Local\\SCSTelemetry) and prints head.offset.

M1 reconnaissance: turn the camera with the mouse, switch cameras, pause, and watch
which fields change and how. Needs a built scs-telemetry.dll
in <game>\\bin\\win_x64\\plugins\\.

    py tools/shm_probe.py                 # 10 lines per second
    py tools/shm_probe.py --hz 30 --csv docs/probe.csv

Press Enter while recording to put a mark into the CSV (the "mark" column counts them):
for example on each switch between the cab and an outside camera.
"""
import argparse
import csv
import ctypes
import ctypes.wintypes as wt
import os
import struct
import sys
import threading
import time

MMF_NAME = "Local\\SCSTelemetry"
MMF_SIZE = 32 * 1024
FILE_MAP_READ = 0x0004

# Offsets from scs-telemetry-common.hpp, computed with offsetof (MSVC x64).
OFF_PAUSED = 4
OFF_RENDER_TIME = 24          # u64, updated every frame
OFF_SPEED = 948               # truck_f.speed, m/s, negative when reversing
OFF_GAME_STEER = 972          # truck_f.gameSteer, -1..1, positive is left
OFF_CABIN_OFFSET = 2000       # 6 floats: x y z heading pitch roll
OFF_HEAD_OFFSET = 2024        # 6 floats: x y z heading pitch roll
OFF_TRUCK_ROTATION = 2224     # 3 doubles: heading pitch roll (world)
OFF_TRUCK_BRAND = 2364
OFF_TRUCK_NAME = 2492
STR_SIZE = 64

k32 = ctypes.WinDLL("kernel32", use_last_error=True)
k32.OpenFileMappingW.argtypes = [wt.DWORD, wt.BOOL, wt.LPCWSTR]
k32.OpenFileMappingW.restype = wt.HANDLE
k32.MapViewOfFile.argtypes = [wt.HANDLE, wt.DWORD, wt.DWORD, wt.DWORD, ctypes.c_size_t]
k32.MapViewOfFile.restype = ctypes.c_void_p


def open_view():
    # Only opens existing memory: if we created it before the game,
    # the plugin might not get write access.
    printed = False
    while True:
        handle = k32.OpenFileMappingW(FILE_MAP_READ, False, MMF_NAME)
        if handle:
            view = k32.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, MMF_SIZE)
            if view:
                return view
        if not printed:
            print(f"waiting for {MMF_NAME} (the game with the plugin is not running)...", file=sys.stderr)
            printed = True
        time.sleep(1.0)


def read(view, offset, fmt):
    return struct.unpack_from(fmt, ctypes.string_at(view + offset, struct.calcsize(fmt)))


def read_str(view, offset):
    return ctypes.string_at(view + offset, STR_SIZE).split(b"\0", 1)[0].decode("utf-8", "replace")


def deg(turns):
    """SCS turns -> degrees in -180..180 (heading arrives in [0,1))."""
    return (turns * 360.0 + 180.0) % 360.0 - 180.0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hz", type=float, default=10.0, help="output rate")
    parser.add_argument("--csv", help="append the values to a CSV file")
    args = parser.parse_args()

    view = open_view()
    truck = f"{read_str(view, OFF_TRUCK_BRAND)} {read_str(view, OFF_TRUCK_NAME)}".strip()
    print(f"connected, truck: {truck or '?'}")

    writer = None
    if args.csv:
        os.makedirs(os.path.dirname(os.path.abspath(args.csv)), exist_ok=True)
        csv_file = open(args.csv, "a", newline="", encoding="utf-8")
        writer = csv.writer(csv_file)
        writer.writerow(["t", "mark", "paused", "frame", "speed", "steer",
                         "hx", "hy", "hz", "h_raw", "yaw", "pitch", "roll",
                         "cx", "cy", "cz", "cabin_yaw", "cabin_pitch", "cabin_roll", "truck_heading"])

    # Enter puts a mark: the column counts them, so the parts of a recording can be told apart.
    marks = [0]

    def count_marks():
        for _ in sys.stdin:
            marks[0] += 1
            print(f"--- mark {marks[0]} ---", flush=True)

    threading.Thread(target=count_marks, daemon=True).start()

    last_render = None
    period = 1.0 / args.hz
    while True:
        (paused,) = read(view, OFF_PAUSED, "?")
        (render_time,) = read(view, OFF_RENDER_TIME, "Q")
        hx, hy, hz, hh, hp, hr = read(view, OFF_HEAD_OFFSET, "6f")
        cx, cy, cz, ch, cp, cr = read(view, OFF_CABIN_OFFSET, "6f")
        (speed,) = read(view, OFF_SPEED, "f")
        (steer,) = read(view, OFF_GAME_STEER, "f")
        (th, _, _) = read(view, OFF_TRUCK_ROTATION, "3d")

        # '·' means the frame did not change since the previous line (game in a menu or minimized).
        frame = "·" if render_time == last_render else " "
        last_render = render_time

        print(f"{'P' if paused else ' '}{frame} head pos {hx:+.3f} {hy:+.3f} {hz:+.3f} m"
              f"  yaw {deg(hh):+7.1f}° (raw {hh:.4f})  pitch {deg(hp):+6.1f}°  roll {deg(hr):+6.1f}°"
              f"  | cabin yaw {deg(ch):+5.1f}°  truck hdg {deg(th):+7.1f}°", flush=True)

        if writer:
            # Head and cab values in full: whether they stand exactly still matters.
            writer.writerow([f"{time.time():.3f}", marks[0], int(paused), int(frame == " "), f"{speed:.2f}", f"{steer:.4f}",
                             repr(hx), repr(hy), repr(hz), repr(hh),
                             f"{deg(hh):.2f}", f"{deg(hp):.2f}", f"{deg(hr):.2f}",
                             repr(cx), repr(cy), repr(cz),
                             f"{deg(ch):.3f}", f"{deg(cp):.3f}", f"{deg(cr):.3f}", f"{deg(th):.2f}"])
            csv_file.flush()
        time.sleep(period)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
