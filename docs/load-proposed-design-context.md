# Load Proposed Design Context

Source reference:

- `C:\Users\Admin\Documents\NDCS SmartRPD\Phase 4 - CG Funding\for DLL to run on server\smartrpd dll to server\2d load proposed design web.docx`
- The Word file is a transcript from previous Codex work around session `019fe23b-1cde-7f42-840f-cbeed6ce1eb8`, titled "Trace 2D proposed design DLL".

## Previous Frontend Work

The prior web-app implementation was done in a temporary checkout at `D:\Github\.tmp-test-web`.

The reported frontend changes were:

- Added `generateDentureDesignOptions()` in `src/js/2D/jawStructApi.js`.
- The function posts current upper/lower L2 jaw-struct data to `POST /dll/compute-denture-design-options`.
- Rewired `src/js/2D/2DAnnotation.js` so the "Load Proposed Design" action:
  - sends the current jaw state to the backend DLL endpoint;
  - handles DLL return/status codes `0`, `5001`, `5002`, `5003`, and `5004`;
  - accepts flexible backend response wrappers such as `body.options`, `body.data.options`, `body.result.options`;
  - shows an option picker when multiple proposed designs are returned;
  - decodes, applies, and renders the selected option through the existing jaw-struct pipeline.
- Updated `src/pages/2DAnnotation.html` to expose the visible button.
- Added proposed-design option modal markup/styles.
- Updated help/tour wording from "template jaw" to "proposed design".

There was also a Vite-on-Windows issue in `src/js/shared/accessibility.js`: using `new URL(..., import.meta.url)` triggered Vite's `asset-import-meta-url` plugin and failed with `spawn EPERM`. The prior fix was to resolve vendored `html2canvas` and `jspdf` scripts from `window.location` and the app root instead.

## Backend Endpoint

The backend endpoint discussed was:

```text
POST /api/smartrpd/dll/compute-denture-design-options
```

The frontend call path expected by the prior implementation was:

```text
window.SMARTRPD_API_BASE + /dll/compute-denture-design-options
```

Expected request payload shape:

```json
{
  "case_id": 2270,
  "uuid": "case-or-user-uuid",
  "upper": { "jawStructBase64": "..." },
  "lower": { "jawStructBase64": "..." },
  "jawMaterial": "..."
}
```

Expected successful wrapper-style response shape:

```json
{
  "successful": true,
  "return_code": 0,
  "options": [
    {
      "index": 0,
      "records": [
        {
          "type": "upper_jaw",
          "filename": "JawUpper_Option_0_Struct_L2.txt",
          "data": "base64..."
        },
        {
          "type": "lower_jaw",
          "filename": "JawLower_Option_0_Struct_L2.txt",
          "data": "base64..."
        }
      ]
    }
  ]
}
```

## Backend Findings From Previous Chat

The backend folder referenced in the transcript was:

```text
D:\Github\SmartRPD_withsurveyangle and loadproposed\SmartRPD
```

Files reported as present and syntactically OK:

- `routes/smartrpdDll.routes.js`
- `controllers/smartrpdDll.controller.js`
- `utils/smartrpdDll.service.js`

The survey-angle issue was separated from the proposed-design issue:

- Survey angle calls `POST /dll/compute-surveying-no-pd`.
- Survey angle needs STL rows in `jaw_stls` for `case_id` plus `type` (`1` upper, `2` lower).
- A previous local DB connection failed with `connect ETIMEDOUT 10.148.0.3:3306`.
- The user later confirmed survey angle worked again after removing the bad M2 DLL load behavior.

The proposed-design 501 response was considered expected until the native bridge is configured:

```text
compute_denture_design_options is not configured.
Set SMART_RPD_DENTURE_OPTIONS_COMMAND to a wrapper executable that reads JSON from stdin and returns JSON with { successful, return_code, options }.
```

The key backend conclusion was: the frontend call and route can be correct while the backend still returns 501 because the backend has no configured way to create valid native `Jaw*` objects for `compute_denture_design_options`.

## Native DLL Boundary

The M2 header discussed was:

```text
D:\Github\SmartRPD_withsurveyangle and loadproposed\DLL\M2_generate_matrix_table.h
```

The important native function signature was:

```cpp
int compute_denture_design_options(Jaw * UserJaw[MAX_JAW_OPTIONS]);
```

Related functions:

```cpp
int Read_Jaw_From_TextFile_L2(Jaw * UserJaw);
int Write_Jaw_To_TextFile_L2(Jaw * UserJaw);
```

The DLL exports reported in the previous chat were:

- `Read_Jaw_From_TextFile_L1`
- `Read_Jaw_From_TextFile_L2`
- `Update_MinorConn_State`
- `Write_Jaw_To_TextFile_L1`
- `Write_Jaw_To_TextFile_L2`
- `compute_denture_design`
- `compute_denture_design_options`

Allocator exports were not available:

```cpp
// Jaw* new_m2_data();
// int delete_m2_data(Jaw *UserJaw);
```

This is why the previous conclusion was that direct Node/Koffi calling is blocked unless the DLL exposes a safe allocator/free pair or the exact full C++ struct layout and initialization rules are implemented.

## Recommended Backend Paths

Route A: use the C++ DLL algorithm.

- Best native-DLL fix: rebuild/export allocator functions:

```cpp
extern "C" M2_GENERATE_MATRIX_TABLE_API Jaw* new_m2_data(Jaw_Type jawType);
extern "C" M2_GENERATE_MATRIX_TABLE_API int delete_m2_data(Jaw *UserJaw);
```

- Then Node/Koffi can follow the existing `Surface_Mesh*` pattern:
  - allocate native object in the DLL;
  - read L2 text into the native object;
  - call `compute_denture_design_options`;
  - write resulting native objects back to L2 text;
  - return base64 L2 text to the frontend.

Route B: use a wrapper executable.

- Configure:

```text
SMART_RPD_DENTURE_OPTIONS_COMMAND=<path-to-wrapper.exe>
```

- The wrapper should:
  - read JSON from stdin;
  - decode upper/lower L2 jaw-struct text;
  - create native Jaw objects using the C++ headers;
  - call `compute_denture_design_options`;
  - write output Jaw objects back to L2 text;
  - emit JSON to stdout in the expected frontend shape.

Route C: do not use the DLL algorithm.

- The web app already knows how to load/save/apply L2 jaw-struct text.
- If the proposed design can be generated from existing frontend template/design rules, the backend can return frontend-compatible L2 jaw-struct options directly.
- This would not call `compute_denture_design_options`, so it may not match the C++ algorithm.

## Current Repo Signal

In this workspace, initial search found old/template wording but not the prior proposed-design implementation:

- `src/js/2D/2DAnnotation.js` still contains "Could not load the template jaw".
- `src/js/shared/helpTopics.js` still contains "Load a template jaw or draw from scratch".
- No current hits were found for `generateDentureDesignOptions`, `compute-denture-design-options`, or `proposedDesign` under `src`.

This suggests the previous temporary web-app changes may need to be ported into this current repository before the frontend side is complete here.

## Current Implementation Notes

Updated after the successful `compute_denture_design_select()` integration.

The current native flow uses the new M2 DLL functions:

```cpp
void create_jawstruct_memory(Jaw *UserJaw);
void delete_jawstruct_memory(Jaw *UserJaw);
void create_jawstruct_memory_doubleptr(Jaw **UserJaw);
Jaw * create_jawstruct_memory_retptr(void);
int compute_denture_design_select(int Design_Option, Jaw *UserJaw);
```

Backend location:

```text
C:\Users\Admin\Documents\NDCS SmartRPD\Phase 4 - CG Funding\for DLL to run on server\smartrpd dll to server\SmartRPD_withsurveyangle and loadproposed
```

Backend behavior:

- `utils/smartrpdDll.service.js` allocates `Jaw*` through `create_jawstruct_memory_retptr()` first.
- It falls back to `create_jawstruct_memory_doubleptr(Jaw**)`.
- The old caller-owned raw buffer path remains only as an env-size fallback.
- `computeDentureDesignOptions()` now calls native `compute_denture_design_select(1, jawPtr)`.
- Design option defaults to `1` / Heavy.
- The backend writes each single-jaw L2 payload under multiple candidate filenames before `Read_Jaw_From_TextFile_L2()`:

```text
JawUpper_Struct_L2.txt
JawLower_Struct_L2.txt
Jaw_Upper_Struct_L2.txt
Jaw_Lower_Struct_L2.txt
Jaw_Struct_L2.txt
JawStruct_L2.txt
```

This fixed the earlier lower-jaw `Read_Jaw_From_TextFile_L2 returned non-zero code 5004` problem. The DLL read function does not take a filename argument, so it appears sensitive to hardcoded or expected filenames in the working directory.

Frontend behavior:

- `src/js/2D/jawStructApi.js` exposes `generateDentureDesignSelect()`.
- It posts to `/dll/compute-denture-design-select`.
- It sends current L2 jaw-struct base64 records plus `jaw_material`, `jawMaterial`, `design_option`, and `designOption`.
- `src/js/2D/2DAnnotation.js` calls the DLL first when the user clicks Load Proposed Design.
- If the DLL call fails or returns no records, the existing local Kennedy/fallback proposal modal remains in place and is shown.
- The frontend filters requested jaws through `classifyArch(state.teeth, jaw)?.classNumber`.
- Therefore:
  - dentate jaws are not sent;
  - fully edentulous jaws are not sent;
  - only valid partial-edentulous Kennedy-class jaws are sent.

Confirmed working cases:

- Upper-only partial-edentulous case:

```text
[jawStructApi] proposed design jaws: ['upper_jaw']
POST /dll/compute-denture-design-select status=200
upper returned and applied through jawStructApply
```

- Dual-jaw partial-edentulous case:

```text
[jawStructApi] proposed design jaws: ['upper_jaw', 'lower_jaw']
POST /dll/compute-denture-design-select status=200
upper and lower both returned and applied through jawStructApply
```

- Metal and full-acrylic material values reached the backend correctly:

```text
jaw_material: 0
jaw_material: 2
```

Observed successful backend sequence:

```text
compute_denture_design_select:prepared
compute_denture_design_select:read_l2:start
compute_denture_design_select:read_l2:done
compute_denture_design_select:native_compute:start
compute_denture_design_select:native_compute:done returnCode: 0
```

The backend M2 DLL inside the REST API folder needed to be updated because the older copy did not export `compute_denture_design_select`, `create_jawstruct_memory_retptr`, or `create_jawstruct_memory_doubleptr`. A timestamped backup was created before replacing it.
