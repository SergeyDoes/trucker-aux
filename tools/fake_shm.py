"""Fake shared memory of scs-sdk-plugin for debugging without the game.

Creates Local\\SCSTelemetry and swings heading as a ±90° sine with an 8 s period.
The engine and the electrics are on unless switched off with a flag. --truck sets the
truck id (default vehicle.fake.truck, named "Fake Truck"), --hook the fifth-wheel
position in metres that names the chassis (default: none reported), --plate the licence
plate, --quick-job marks the truck as lent for a quick job (its plate is random),
--blinker keeps the left or right blinker lever on. It reports plugin revision 12 and the truck
standing at (1000, 50, -2000) in the world, heading north. --camera also writes a fake
Local\\TruckerAuxCamera (native/camera-plugin): "cab" puts the camera at the head, looking 15° left
of where the head offset turns it (the game's look into turns, say); "outside" 6 m behind.
Run only with the game closed: otherwise the plugins and the script write to the same memory.

    py tools/fake_shm.py [--engine-off] [--electrics-off] [--truck ID] [--hook METRES]
                         [--plate TEXT] [--quick-job] [--blinker left|right] [--camera cab|outside]
"""
import argparse
import math
import mmap
import struct
import time

MMF_NAME = "Local\\SCSTelemetry"
MMF_SIZE = 32 * 1024
CAMERA_NAME = "Local\\TruckerAuxCamera"  # native/camera-plugin/camera_block.h
CAMERA_SIZE = 64
WORLD = (1000.0, 50.0, -2000.0)  # the truck in the world; heading, pitch, roll 0
HEAD = (-0.45, -0.05, 0.0)  # cabinPosition (0) + headPosition + the head offset's x y z below


def main():
    parser = argparse.ArgumentParser(description="Fake scs-sdk-plugin shared memory")
    parser.add_argument("--engine-off", action="store_true")
    parser.add_argument("--electrics-off", action="store_true")
    parser.add_argument("--truck", default="vehicle.fake.truck")
    parser.add_argument("--hook", type=float, default=0.0)
    parser.add_argument("--plate", default="")
    parser.add_argument("--quick-job", action="store_true")
    parser.add_argument("--blinker", choices=("left", "right"))
    parser.add_argument("--game", choices=("ats", "ets2"), default="ats")
    parser.add_argument("--camera", choices=("cab", "outside"))
    args = parser.parse_args()
    electrics = not args.electrics_off
    engine = electrics and not args.engine_off
    brand_id = args.truck.split(".")[1] if args.truck.count(".") >= 2 else "fake"
    name = args.truck.split(".")[-1] if args.truck != "vehicle.fake.truck" else "Truck"

    # If another process still holds the memory (for example shm_to_osc.py after a game),
    # it contains game data: overwrite whole fields.
    mem = mmap.mmap(-1, MMF_SIZE, tagname=MMF_NAME)
    struct.pack_into("?", mem, 0, True)   # sdkActive
    struct.pack_into("?", mem, 4, False)  # paused
    struct.pack_into("<I", mem, 40, 12)  # scs_values.telemetry_plugin_revision: the one the app knows
    struct.pack_into("<I", mem, 52, 2 if args.game == "ats" else 1)  # scs_values.game
    struct.pack_into("<6f", mem, 2000, *([0.0] * 6))  # truck_fp.cabinOffset: the cab at rest
    struct.pack_into("<6d", mem, 2200, *WORLD, 0.0, 0.0, 0.0)  # truck_dp: world position, heading pitch roll
    struct.pack_into("?", mem, 1575, electrics)  # truck_b.electricEnabled
    struct.pack_into("?", mem, 1576, engine)     # truck_b.engineEnabled
    struct.pack_into("?", mem, 1578, args.blinker == "left")   # truck_b.blinkerLeftActive
    struct.pack_into("?", mem, 1579, args.blinker == "right")  # truck_b.blinkerRightActive
    struct.pack_into("<3f", mem, 1640, 0.0, 0.0, 0.0)  # config_fv.cabinPosition
    struct.pack_into("<3f", mem, 1652, -0.45, 0.0, 0.0)  # config_fv.headPosition: 45 cm left of the axis
    struct.pack_into("<3f", mem, 1664, 0.0, 0.0, args.hook)  # config_fv.truckHookPosition
    strings = ((2300, brand_id), (2364, brand_id.capitalize()), (2428, args.truck), (2492, name))
    for offset, value in strings:
        mem[offset:offset + 64] = value.encode().ljust(64, b"\0")
    mem[3212:3212 + 64] = args.plate.encode().ljust(64, b"\0")  # config_s.truckLicensePlate
    mem[3404:3404 + 32] = (b"quick_job" if args.quick_job else b"").ljust(32, b"\0")  # config_s.jobMarket
    print(f"{args.truck}, hook {args.hook} m, plate {args.plate or '-'}{', quick job' if args.quick_job else ''}{f', {args.blinker} blinker' if args.blinker else ''}; engine {'on' if engine else 'off'}, electrics {'on' if electrics else 'off'}")
    camera = None
    if args.camera:
        camera = mmap.mmap(-1, CAMERA_SIZE, tagname=CAMERA_NAME)
        struct.pack_into("<4I", camera, 0, 1, 0, 1, 0 if args.camera == "cab" else 1)  # layout, sequence, reading, index
    print("writing the pose to Local\\SCSTelemetry" + (f" and a {args.camera} camera to {CAMERA_NAME}" if camera else "")
          + ", Ctrl+C to quit")
    start = time.monotonic()
    sequence = 0
    while True:
        t = time.monotonic() - start
        heading = (0.25 * math.sin(2 * math.pi * t / 8)) % 1.0  # turns in [0,1), as in the SDK
        struct.pack_into("6f", mem, 2024, 0.0, HEAD[1], 0.0, heading, 0.0, 0.0)
        if camera:
            if args.camera == "cab":  # at the head, turned 15° further left than the head offset
                position, yaw, fov = HEAD, heading * 2 * math.pi + math.radians(15), 65.0
            else:  # a chase camera: 1.5 m up, 6 m behind, looking ahead
                position, yaw, fov = (HEAD[0], HEAD[1] + 1.5, HEAD[2] + 6.0), 0.0, 60.0
            world = [w + p for w, p in zip(WORLD, position)]
            struct.pack_into("<I", camera, 4, sequence + 1)  # odd: being written
            struct.pack_into("<f4x3d4f", camera, 16, fov, *world, math.cos(yaw / 2), 0.0, math.sin(yaw / 2), 0.0)
            sequence += 2
            struct.pack_into("<I", camera, 4, sequence)
        # renderTime (µs) advances with every frame; it stands still in the game's main menu.
        struct.pack_into("<Q", mem, 24, int(t * 1_000_000))
        time.sleep(0.01)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
