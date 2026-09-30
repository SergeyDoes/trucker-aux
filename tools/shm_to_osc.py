"""Мост для A0: head.offset из общей памяти scs-sdk-plugin -> OSC /ypr.

SPARTA Binauraliser принимает /ypr (yaw, pitch, roll в градусах) на порту 9000;
приём OSC включается вместе с Enable Rotation. На паузе шлём (0, 0, 0).

    py tools/shm_to_osc.py                  # 127.0.0.1:9000, 100 Гц
    py tools/shm_to_osc.py --port 9001 --hz 60
"""
import argparse
import socket
import struct
import time

from shm_probe import OFF_HEAD_OFFSET, OFF_PAUSED, deg, open_view, read


def osc_string(s):
    b = s.encode("ascii")
    return b + b"\0" * (4 - len(b) % 4)  # минимум один \0, выравнивание до 4


def osc_message(address, *floats):
    return (osc_string(address) + osc_string("," + "f" * len(floats))
            + struct.pack(">" + "f" * len(floats), *floats))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9000)
    parser.add_argument("--hz", type=float, default=100.0, help="частота опроса памяти")
    args = parser.parse_args()

    view = open_view()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    target = (args.host, args.port)
    print(f"шлю /ypr на {args.host}:{args.port}, Ctrl+C для выхода")

    period = 1.0 / args.hz
    last_ypr, last_send, last_print, sent = None, 0.0, 0.0, 0
    while True:
        (paused,) = read(view, OFF_PAUSED, "?")
        _, _, _, heading, pitch, roll = read(view, OFF_HEAD_OFFSET, "6f")
        ypr = (0.0, 0.0, 0.0) if paused else (deg(heading), deg(pitch), deg(roll))

        now = time.monotonic()
        # Шлём при изменении и раз в 0.5 с, чтобы перезапущенный хост подхватил позу.
        if ypr != last_ypr or now - last_send > 0.5:
            try:
                sock.sendto(osc_message("/ypr", *ypr), target)
                sent += 1
            except OSError:
                pass
            last_ypr, last_send = ypr, now

        if now - last_print >= 1.0:
            state = "пауза" if paused else "     "
            print(f"{state} yaw {ypr[0]:+7.1f}°  pitch {ypr[1]:+6.1f}°  roll {ypr[2]:+6.1f}°  пакетов {sent}", flush=True)
            last_print = now
        time.sleep(period)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
