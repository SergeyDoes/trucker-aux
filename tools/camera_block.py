"""Prints the camera that trucker_aux_camera.dll reads (Local\\TruckerAuxCamera): the camera
manager's index, the state, the FOV and where it is in the world. A line each time the index or
the state changes (marked *), else every 5 s. Switch through the game's cameras (1..9, and 0
for the free camera with g_developer "1") to see which index is which. Opened read only.

    py tools/camera_block.py
"""
import struct
import time

from camera_probe import Mapping

NAME = "Local\\TruckerAuxCamera"  # native/camera-plugin/camera_block.h
SIZE = 64
STATES = {0: "looking for the camera", 1: "reading", 2: "off after a fault"}


def read(mapping):
    """The block when it is whole (an even sequence, the same after the copy), else None."""
    for _ in range(10):
        sequence = struct.unpack("<I", mapping.read(4, 4))[0]
        data = mapping.read(0, SIZE)
        if sequence % 2 == 0 and struct.unpack_from("<I", data, 4)[0] == sequence:
            return data
    return None


def main():
    mapping = Mapping(NAME, SIZE)
    while not mapping.open():
        print("waiting for", NAME, "(the game with trucker_aux_camera.dll)")
        time.sleep(2)
    last, printed = None, 0.0
    while True:
        data = read(mapping)
        if data:
            _, sequence, state, index, fov = struct.unpack_from("<4If", data, 0)
            x, y, z = struct.unpack_from("<3d", data, 24)
            now = time.monotonic()
            changed = (index, state) != last
            if changed or now - printed >= 5:
                print(f"{time.strftime('%H:%M:%S')} {'*' if changed else ' '} camera {index}, "
                      f"{STATES.get(state, state)}, fov {fov:.1f}, at ({x:.2f}, {y:.2f}, {z:.2f}), "
                      f"frame {sequence // 2}")
                last, printed = (index, state), now
        time.sleep(0.05)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
