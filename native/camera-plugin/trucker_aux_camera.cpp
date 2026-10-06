// trucker_aux_camera.dll: an SCS telemetry plugin that copies the camera the game renders with
// into Local\TruckerAuxCamera (camera_block.h) each frame, for Trucker AUX. It only reads the
// game's memory: nothing is written into the game and no game function is called. Every read
// is inside a structured exception handler; a fault switches it off for the session, so a
// game update that moves things cannot crash the game.
//
// The camera manager's pattern and the structure offsets come from the ETS2LA game plugin
// (https://github.com/ETS2LA/plugin, MIT, Copyright (c) 2024 Dario Wouters; see
// LICENSE-ETS2LA.txt): src/patterns.win32.hpp, src/prism/camera/*.hpp, game 1.60-1.61.
#include <windows.h>

#include <cmath>
#include <cstdint>
#include <cstdio>

#include "scssdk_telemetry.h"

#include "camera_block.h"

namespace
{
    // "48 8b 05 ? ? ? ? 48 8b fa 48 85 c0 0f": mov rax, [rip + camera_manager]; the 32-bit
    // displacement at +3 leads to the pointer to the camera manager.
    const uint8_t PATTERN[] = { 0x48, 0x8b, 0x05, 0, 0, 0, 0, 0x48, 0x8b, 0xfa, 0x48, 0x85, 0xc0, 0x0f };
    const char MASK[] = "xxx????xxxxxxx";
    const size_t DISPLACEMENT = 3;

    // camera_manager_u (Windows): current_camera @0x10; cameras, an array_dyn_t (a vtable, then
    // the data pointer and the size) @0x30. core_camera_u: camera_fov @0x20; placement_t @0x40:
    // position x y z, sector cx cz (int16) @0x4C, rotation w x y z @0x50.
    const uintptr_t MANAGER_CURRENT = 0x10;
    const uintptr_t MANAGER_CAMERAS = 0x30 + 0x08;
    const uintptr_t MANAGER_COUNT = 0x30 + 0x10;
    const uintptr_t CAMERA_FOV = 0x20;
    const uintptr_t CAMERA_POSITION = 0x40;
    const uintptr_t CAMERA_SECTOR = 0x4C;
    const uintptr_t CAMERA_ROTATION = 0x50;
    const double SECTOR = 512.0;

    scs_log_t game_log = nullptr;
    HANDLE mapping = nullptr;
    TruckerAuxCamera *block = nullptr;
    HANDLE scanner = nullptr;
    volatile LONG64 manager_pointer = 0; // where the pointer to the camera manager lives, once found
    volatile LONG scan_done = 0;
    bool scan_reported = false;
    bool off = false;

    void log(const char *text)
    {
        if (game_log) game_log(SCS_LOG_TYPE_message, text);
    }

    // The game's code sections searched for the pattern; 0 when it is not there.
    uintptr_t find_pattern()
    {
        const auto base = reinterpret_cast<uintptr_t>(GetModuleHandleW(nullptr));
        if (!base) return 0;
        const auto dos = reinterpret_cast<const IMAGE_DOS_HEADER *>(base);
        const auto nt = reinterpret_cast<const IMAGE_NT_HEADERS64 *>(base + dos->e_lfanew);
        const IMAGE_SECTION_HEADER *section = IMAGE_FIRST_SECTION(nt);
        for (WORD s = 0; s < nt->FileHeader.NumberOfSections; s++, section++)
        {
            if (!(section->Characteristics & IMAGE_SCN_CNT_CODE)) continue;
            const auto start = reinterpret_cast<const uint8_t *>(base + section->VirtualAddress);
            const size_t size = section->Misc.VirtualSize;
            for (size_t i = 0; i + sizeof(PATTERN) <= size; i++)
            {
                size_t k = 0;
                while (k < sizeof(PATTERN) && (MASK[k] == '?' || start[i + k] == PATTERN[k])) k++;
                if (k == sizeof(PATTERN)) return reinterpret_cast<uintptr_t>(start + i);
            }
        }
        return 0;
    }

    // Once, off the game's thread: the scan takes a moment.
    DWORD WINAPI scan(void *)
    {
        uintptr_t found = 0;
        __try
        {
            found = find_pattern();
            if (found)
            {
                const auto displacement = *reinterpret_cast<const int32_t *>(found + DISPLACEMENT);
                found = found + DISPLACEMENT + 4 + displacement;
            }
        }
        __except (EXCEPTION_EXECUTE_HANDLER)
        {
            found = 0;
        }
        InterlockedExchange64(&manager_pointer, static_cast<LONG64>(found));
        InterlockedExchange(&scan_done, 1);
        return 0;
    }

    struct Reading
    {
        uint32_t camera;
        float fov;
        double x, y, z;
        float qw, qx, qy, qz;
    };

    enum Result
    {
        NO_CAMERA, // no manager or camera at the moment (menus, loading)
        GOT_CAMERA,
        FAULT,
    };

    // A plain function (no C++ objects to unwind) for __try.
    Result read_camera(uintptr_t pointer, Reading *out)
    {
        __try
        {
            const auto manager = *reinterpret_cast<const uintptr_t *>(pointer);
            if (!manager) return NO_CAMERA;
            const auto current = *reinterpret_cast<const uint32_t *>(manager + MANAGER_CURRENT);
            const auto cameras = *reinterpret_cast<const uintptr_t *>(manager + MANAGER_CAMERAS);
            const auto count = *reinterpret_cast<const uint64_t *>(manager + MANAGER_COUNT);
            if (!cameras || count == 0 || count > 64 || current >= count) return NO_CAMERA;
            const auto camera = *reinterpret_cast<const uintptr_t *>(cameras + 8 * static_cast<uintptr_t>(current));
            if (!camera) return NO_CAMERA;
            const auto p = reinterpret_cast<const float *>(camera + CAMERA_POSITION);
            const auto sector = reinterpret_cast<const int16_t *>(camera + CAMERA_SECTOR);
            const auto q = reinterpret_cast<const float *>(camera + CAMERA_ROTATION);
            out->camera = current;
            out->fov = *reinterpret_cast<const float *>(camera + CAMERA_FOV);
            out->x = p[0] + sector[0] * SECTOR;
            out->y = p[1];
            out->z = p[2] + sector[1] * SECTOR;
            out->qw = q[0];
            out->qx = q[1];
            out->qy = q[2];
            out->qz = q[3];
            return GOT_CAMERA;
        }
        __except (EXCEPTION_EXECUTE_HANDLER)
        {
            return FAULT;
        }
    }

    // Whether a reading looks like a camera: what a moved structure would not give.
    bool plausible(const Reading &r)
    {
        const double norm = std::sqrt(double(r.qw) * r.qw + double(r.qx) * r.qx + double(r.qy) * r.qy + double(r.qz) * r.qz);
        return std::isfinite(r.fov) && r.fov > 10.0f && r.fov < 170.0f
            && std::isfinite(r.x) && std::isfinite(r.y) && std::isfinite(r.z)
            && std::fabs(r.y) < 1.0e5 && std::fabs(r.x) < 1.0e7 && std::fabs(r.z) < 1.0e7
            && std::isfinite(norm) && std::fabs(norm - 1.0) < 0.01;
    }

    void publish(uint32_t state, const Reading *r)
    {
        const uint32_t sequence = block->sequence;
        block->sequence = sequence + 1; // odd: being written
        MemoryBarrier();
        block->state = state;
        if (r)
        {
            block->camera = r->camera;
            block->fov = r->fov;
            block->x = r->x;
            block->y = r->y;
            block->z = r->z;
            block->qw = r->qw;
            block->qx = r->qx;
            block->qy = r->qy;
            block->qz = r->qz;
        }
        MemoryBarrier();
        block->sequence = sequence + 2;
    }

    SCSAPI_VOID frame_end(const scs_event_t, const void *const, const scs_context_t)
    {
        if (!block) return;
        if (off)
        {
            publish(TRUCKER_AUX_CAMERA_OFF, nullptr);
            return;
        }
        const auto pointer = static_cast<uintptr_t>(InterlockedCompareExchange64(&manager_pointer, 0, 0));
        if (!scan_reported && InterlockedCompareExchange(&scan_done, 0, 0))
        {
            scan_reported = true; // the game's log, written from the game's thread
            log(pointer ? "[Trucker AUX camera] found the camera manager"
                        : "[Trucker AUX camera] the camera manager was not found (another game version?): off");
        }
        if (!pointer)
        {
            publish(TRUCKER_AUX_CAMERA_LOOKING, nullptr);
            return;
        }
        Reading r = {};
        switch (read_camera(pointer, &r))
        {
        case GOT_CAMERA:
            if (plausible(r))
                publish(TRUCKER_AUX_CAMERA_READING, &r);
            else
                publish(TRUCKER_AUX_CAMERA_LOOKING, nullptr);
            break;
        case NO_CAMERA:
            publish(TRUCKER_AUX_CAMERA_LOOKING, nullptr);
            break;
        case FAULT:
            off = true;
            log("[Trucker AUX camera] a fault reading the camera: switched off for this session");
            publish(TRUCKER_AUX_CAMERA_OFF, nullptr);
            break;
        }
    }

    void release()
    {
        if (scanner)
        {
            WaitForSingleObject(scanner, 5000);
            CloseHandle(scanner);
            scanner = nullptr;
        }
        if (block)
        {
            publish(TRUCKER_AUX_CAMERA_LOOKING, nullptr);
            UnmapViewOfFile(block);
            block = nullptr;
        }
        if (mapping)
        {
            CloseHandle(mapping);
            mapping = nullptr;
        }
    }
}

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t *const params)
{
    if (version != SCS_TELEMETRY_VERSION_1_00 && version != SCS_TELEMETRY_VERSION_1_01) return SCS_RESULT_unsupported;
    const auto init = static_cast<const scs_telemetry_init_params_v100_t *>(params);
    game_log = init->common.log;

    mapping = CreateFileMappingW(INVALID_HANDLE_VALUE, nullptr, PAGE_READWRITE, 0, sizeof(TruckerAuxCamera), TRUCKER_AUX_CAMERA_NAME);
    if (!mapping)
    {
        log("[Trucker AUX camera] cannot create Local\\TruckerAuxCamera");
        return SCS_RESULT_generic_error;
    }
    block = static_cast<TruckerAuxCamera *>(MapViewOfFile(mapping, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(TruckerAuxCamera)));
    if (!block)
    {
        release();
        return SCS_RESULT_generic_error;
    }
    ZeroMemory(block, sizeof(TruckerAuxCamera));
    block->layout = 1;

    if (init->register_for_event(SCS_TELEMETRY_EVENT_frame_end, frame_end, nullptr) != SCS_RESULT_ok)
    {
        log("[Trucker AUX camera] cannot register for frame_end");
        release();
        return SCS_RESULT_generic_error;
    }
    off = false;
    scan_reported = false;
    InterlockedExchange64(&manager_pointer, 0);
    InterlockedExchange(&scan_done, 0);
    scanner = CreateThread(nullptr, 0, scan, nullptr, 0, nullptr);
    log("[Trucker AUX camera] loaded; looking for the camera");
    return SCS_RESULT_ok;
}

SCSAPI_VOID scs_telemetry_shutdown(void)
{
    // The game unregisters our callbacks itself.
    release();
    game_log = nullptr;
}

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID)
{
    return TRUE;
}
