"""Fake shared memory of scs-sdk-plugin for debugging without the game.

Creates Local\\SCSTelemetry and swings heading as a ±90° sine with an 8 s period.
The engine and the electrics are on unless switched off with a flag. --truck sets the
truck id (default vehicle.fake.truck, named "Fake Truck"), --hook the fifth-wheel
position in metres that names the chassis (default: none reported), --plate the licence
plate, --quick-job marks the truck as lent for a quick job (its plate is random),
--blinker keeps the left or right blinker lever on.
Run only with the game closed: otherwise the plugin and the script write to the same memory.

    py tools/fake_shm.py [--engine-off] [--electrics-off] [--truck ID] [--hook METRES]
                         [--plate TEXT] [--quick-job] [--blinker left|right]
"""
import argparse
import math
import mmap
import struct
import time

MMF_NAME = "Local\\SCSTelemetry"
MMF_SIZE = 32 * 1024


def main():
    parser = argparse.ArgumentParser(description="Fake scs-sdk-plugin shared memory")
    parser.add_argument("--engine-off", action="store_true")
    parser.add_argument("--electrics-off", action="store_true")
    parser.add_argument("--truck", default="vehicle.fake.truck")
    parser.add_argument("--hook", type=float, default=0.0)
    parser.add_argument("--plate", default="")
    parser.add_argument("--quick-job", action="store_true")
    parser.add_argument("--blinker", choices=("left", "right"))
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
    print("writing the pose to Local\\SCSTelemetry, Ctrl+C to quit")
    start = time.monotonic()
    while True:
        t = time.monotonic() - start
        heading = (0.25 * math.sin(2 * math.pi * t / 8)) % 1.0  # turns in [0,1), as in the SDK
        struct.pack_into("6f", mem, 2024, 0.0, -0.05, 0.0, heading, 0.0, 0.0)
        # renderTime (µs) advances with every frame; it stands still in the game's main menu.
        struct.pack_into("<Q", mem, 24, int(t * 1_000_000))
        time.sleep(0.01)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
