// The shared memory Local\TruckerAuxCamera: the camera the game renders with, written by
// trucker_aux_camera.dll each frame and read by Trucker AUX (app/src/main/telemetry.js).
// docs/superpowers/specs/2026-10-06-camera-plugin-design.md
#pragma once
#include <cstdint>

#define TRUCKER_AUX_CAMERA_NAME L"Local\\TruckerAuxCamera"

enum TruckerAuxCameraState : uint32_t
{
    TRUCKER_AUX_CAMERA_LOOKING = 0, // the camera manager not found (yet)
    TRUCKER_AUX_CAMERA_READING = 1, // the record below is the current camera
    TRUCKER_AUX_CAMERA_OFF = 2,     // a fault while reading: off for this session
};

#pragma pack(push, 1)
struct TruckerAuxCamera
{
    uint32_t layout;            // 0: 1
    volatile uint32_t sequence; // 4: odd while being written, even when whole; +2 per write
    uint32_t state;             // 8: TruckerAuxCameraState
    uint32_t camera;            // 12: the camera manager's current camera index
    float fov;                  // 16: degrees
    float reserved;             // 20
    double x, y, z;             // 24: world position (sector added: x + cx * 512, z + cz * 512)
    float qw, qx, qy, qz;       // 48: world rotation; the camera looks along its -Z
};
#pragma pack(pop)

static_assert(sizeof(TruckerAuxCamera) == 64, "the app reads 64 bytes");
