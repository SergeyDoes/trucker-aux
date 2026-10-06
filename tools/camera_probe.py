"""Reads the game's camera from the ETS2LA plugin (Local\\ETS2LACameraProps) and prints where
it is in the truck: the way to place speakers by looking, and to tell the cab camera from an
outside one.

The plugin: https://github.com/ETS2LA/plugin (MIT). No builds are published: open the folder
in Visual Studio (CMake, x64 Release; `git submodule update --init` first for vendor/fmt) and
put ets2la_plugin.dll into <game>\\bin\\win_x64\\plugins\\ next to scs-telemetry.dll. It
reads the game's memory by patterns, so it works with one game version (1.61.x for now).
The free camera: g_developer "1" (and g_console "1") in Documents\\<game>\\config.cfg, then
0 in the game; fly with the numpad, look with the mouse.

    py tools/camera_probe.py                  # 10 lines per second
    py tools/camera_probe.py --hz 30 --csv docs/camera.csv
    py tools/camera_probe.py --selftest       # the maths, without the game (any OS)

Keys, pressed in the game (read from anywhere, a beep answers):
    Ctrl+F9   zero: the camera's place now is the origin. Do it in the cab camera, head
              straight and not moved: the origin is then the driver's default head, as in
              the app (high beep).
    Ctrl+F10  a mark into the CSV (the "mark" column counts them), and the line printed
              again with "mark", e.g. with the free camera at a speaker grille (low beep).
The same in this console: z then Enter, or Enter alone.

Printed: the camera in the truck's axes (X right, Y up, Z back, metres), from the origin once
set, else from the middle of the truck's box; where it looks (a unit vector, -Z is ahead); its
distance from the origin; the FOV. With scs-telemetry.dll running too: the head offset the SDK
reports, to compare in the cab camera.
"""
import argparse
import csv
import math
import os
import struct
import sys
import threading
import time

CAMERA_MMF = "Local\\ETS2LACameraProps"
CAMERA_SIZE = 128
# src/core.hpp CameraMemData: fov, pos xyz (in the sector), sector cx cz (int16), rotation
# wxyz, projection matrix m11..m44, the truck's box centre xyz (world) and rotation wxyz.
CAMERA_FMT = "<4f2h4f16f3f4f"
SECTOR = 512.0  # placement_t::to_global_position: x + cx * 512, z + cz * 512

TELEMETRY_MMF = "Local\\SCSTelemetry"
TELEMETRY_SIZE = 32 * 1024
OFF_CABIN_OFFSET = 2000  # 6 floats: x y z heading pitch roll (tools/shm_probe.py)
OFF_HEAD_OFFSET = 2024
FILE_MAP_READ = 0x0004

assert struct.calcsize(CAMERA_FMT) == CAMERA_SIZE


# Quaternions as (w, x, y, z).
def conj(q):
    w, x, y, z = q
    return (w, -x, -y, -z)


def mul(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw)


def rotate(q, v):
    """v turned by q (as float3_t::rotate in the plugin)."""
    _, x, y, z = mul(mul(q, (0.0, *v)), conj(q))
    return (x, y, z)


def sub(a, b):
    return tuple(p - q for p, q in zip(a, b))


def length(v):
    return math.sqrt(sum(c * c for c in v))


def parse(raw):
    """The plugin's record as a dict; positions in the world (sectors added)."""
    f = struct.unpack(CAMERA_FMT, raw)
    fov, x, y, z, cx, cz = f[0:6]
    return {
        "fov": fov,
        "camera": (cx * SECTOR + x, y, cz * SECTOR + z),
        "camera_rot": tuple(f[6:10]),
        "projection": tuple(f[10:26]),
        "truck": tuple(f[26:29]),
        "truck_rot": tuple(f[29:33]),
    }


def in_truck(record):
    """The camera in the truck's axes, from the truck's box centre; and where it looks
    (-Z of the camera, in the truck's axes)."""
    back = conj(record["truck_rot"])
    position = rotate(back, sub(record["camera"], record["truck"]))
    looks = rotate(mul(back, record["camera_rot"]), (0.0, 0.0, -1.0))
    return position, looks


def selftest():
    # A truck turned 90° left (about Y) at a sector's corner; the camera 1 m to its right
    # and 0.5 m up, looking where the truck looks.
    turn = (math.cos(math.pi / 4), 0.0, math.sin(math.pi / 4), 0.0)
    truck = (3 * SECTOR + 10.0, 5.0, -2 * SECTOR + 20.0)
    right = rotate(turn, (1.0, 0.0, 0.0))
    camera = (truck[0] + right[0], truck[1] + 0.5, truck[2] + right[2])
    raw = struct.pack(CAMERA_FMT, 70.0, camera[0] - 3 * SECTOR, camera[1], camera[2] + 2 * SECTOR, 3, -2,
                      *turn, *([0.0] * 16), *truck, *turn)
    position, looks = in_truck(parse(raw))
    assert all(abs(a - b) < 1e-4 for a, b in zip(position, (1.0, 0.5, 0.0))), position
    assert all(abs(a - b) < 1e-6 for a, b in zip(looks, (0.0, 0.0, -1.0))), looks
    print("selftest ok:", tuple(round(c, 4) for c in position), tuple(round(c, 4) for c in looks))


class Mapping:
    """A named shared memory of the game, opened read only (never created: the plugin must)."""

    def __init__(self, name, size):
        import ctypes
        import ctypes.wintypes as wt
        self.ctypes = ctypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenFileMappingW.argtypes = [wt.DWORD, wt.BOOL, wt.LPCWSTR]
        k32.OpenFileMappingW.restype = wt.HANDLE
        k32.MapViewOfFile.argtypes = [wt.HANDLE, wt.DWORD, wt.DWORD, wt.DWORD, ctypes.c_size_t]
        k32.MapViewOfFile.restype = ctypes.c_void_p
        self.k32, self.name, self.size, self.view = k32, name, size, None

    def open(self):
        handle = self.k32.OpenFileMappingW(FILE_MAP_READ, False, self.name)
        if handle:
            self.view = self.k32.MapViewOfFile(handle, FILE_MAP_READ, 0, 0, self.size)
        return self.view is not None

    def read(self, offset, size):
        return self.ctypes.string_at(self.view + offset, size)


VK_CONTROL, VK_F9, VK_F10 = 0x11, 0x78, 0x79


def beep(freq):
    try:
        import winsound
        winsound.Beep(freq, 120)
    except (ImportError, RuntimeError):
        print("\a", end="", flush=True)


def hotkeys(actions):
    """Ctrl + a key from actions, pressed in any window (the game has the focus): polls the
    keyboard, as a hook would need a message loop. Each press acts once."""
    import ctypes
    state = ctypes.windll.user32.GetAsyncKeyState
    down = set()
    while True:
        ctrl = state(VK_CONTROL) & 0x8000
        for key, act in actions.items():
            pressed = bool(ctrl and state(key) & 0x8000)
            if pressed and key not in down:
                act()
            if pressed:
                down.add(key)
            else:
                down.discard(key)
        time.sleep(0.02)


def fmt3(v):
    return " ".join(f"{c:+7.3f}" for c in v)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hz", type=float, default=10.0, help="output rate")
    parser.add_argument("--csv", help="append the values to a CSV file")
    parser.add_argument("--selftest", action="store_true", help="check the maths and exit")
    args = parser.parse_args()
    if args.selftest:
        return selftest()

    camera = Mapping(CAMERA_MMF, CAMERA_SIZE)
    printed = False
    while not camera.open():
        if not printed:
            print(f"waiting for {CAMERA_MMF} (the game with ets2la_plugin.dll is not running)...", file=sys.stderr)
            printed = True
        time.sleep(1.0)
    telemetry = Mapping(TELEMETRY_MMF, TELEMETRY_SIZE)
    has_telemetry = telemetry.open()
    print(f"connected; scs-telemetry: {'yes' if has_telemetry else 'no (no head offset to compare)'}")

    writer = None
    if args.csv:
        os.makedirs(os.path.dirname(os.path.abspath(args.csv)), exist_ok=True)
        csv_file = open(args.csv, "a", newline="", encoding="utf-8")
        writer = csv.writer(csv_file)
        writer.writerow(["t", "mark", "zeroed", "fov", "x", "y", "z", "look_x", "look_y", "look_z", "distance",
                         "box_x", "box_y", "box_z", "head_x", "head_y", "head_z", "cabin_x", "cabin_y", "cabin_z",
                         *[f"m{r}{c}" for r in range(1, 5) for c in range(1, 5)]])

    state = {"marks": 0, "zero": False, "show": False}

    def zero():
        state["zero"] = True
        beep(1200)

    def mark():
        state["marks"] += 1
        state["show"] = True
        beep(600)

    def commands():
        for line in sys.stdin:
            zero() if line.strip().lower() == "z" else mark()

    threading.Thread(target=commands, daemon=True).start()
    threading.Thread(target=hotkeys, args=({VK_F9: zero, VK_F10: mark},), daemon=True).start()
    print("in the game: Ctrl+F9 sets the origin (in the cab camera, head straight), Ctrl+F10 puts a mark")

    origin = None
    period = 1.0 / args.hz
    while True:
        record = parse(camera.read(0, CAMERA_SIZE))
        box, looks = in_truck(record)
        # Just after a load the truck is not placed yet (NaN, or the camera thousands of metres
        # away, for about 4 s): nothing to print or record.
        if not all(math.isfinite(c) for c in box) or length(box) > 100:
            time.sleep(period)
            continue
        if state["zero"]:
            state["zero"] = False
            origin = box
            print(f"--- origin set: {fmt3(origin)} m from the truck's box centre ---", flush=True)
        position = sub(box, origin) if origin else box
        distance = length(position) if origin else float("nan")
        head = cabin = (float("nan"),) * 3
        if has_telemetry:
            head = struct.unpack("<3f", telemetry.read(OFF_HEAD_OFFSET, 12))
            cabin = struct.unpack("<3f", telemetry.read(OFF_CABIN_OFFSET, 12))
        line = (f"{'origin' if origin else 'box   '} {fmt3(position)} m  looks {fmt3(looks)}"
                f"  dist {distance:5.2f}  fov {record['fov']:5.1f}"
                + (f"  | sdk head {fmt3(head)}  cabin {fmt3(cabin)}" if has_telemetry else ""))
        if state["show"]:
            state["show"] = False
            print(f"--- mark {state['marks']} ---\n{line}", flush=True)
        else:
            print(line, flush=True)
        if writer:
            writer.writerow([f"{time.time():.3f}", state["marks"], int(origin is not None), repr(record["fov"]),
                             *map(repr, position), *(f"{c:.5f}" for c in looks), f"{distance:.4f}",
                             *map(repr, box), *map(repr, head), *map(repr, cabin), *map(repr, record["projection"])])
            csv_file.flush()
        time.sleep(period)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
