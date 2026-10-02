# Photogrammetry pipeline (designed, not yet implemented)

## Pipeline

```
Insta360 X5 / phone / drone images  (Asset: IMAGE_SET)
   │  images.preprocess          validate, de-duplicate, EXIF/GNSS, 360°→perspective, masks
   ▼
Preprocessed views              (Asset: IMAGE_SET, parent = original)
   │  photogrammetry.reconstruct PhotogrammetryEngine.process(job)   SfM + MVS
   ▼
Engine outputs                  (sparse model, dense cloud, optional mesh)
   │  pointcloud.import.engine   statistics, MFPC, provenance
   ▼
Point cloud                     (Asset: POINT_CLOUD, parent = views)
   │  mesh.build
   ▼
Mesh                            (Asset: MESH)
   │  surface.build              ground filtering, TIN / DEM grid
   ▼
Terrain surface                 (Asset: SURFACE)
   │  web.optimize               LOD / tiles for the browser
   ▼
Web representation
```

Each arrow is a separate `ProcessingJob` type (`apps/worker/massefelt_worker/photogrammetry/pipeline.py`). Stages can be retried and re-run independently, and when one stage succeeds it enqueues the next. Every output is a new `Asset` with `parentAssetId`, `processingMethod` (`<engine>`) and `processingVersion` (`<engine version>`).

**All processing runs in the worker, never in an HTTP request.**

## Engine interface

```python
class PhotogrammetryEngine(ABC):
    name: str
    version: str
    def process(self, job: PhotogrammetryJobSpec, progress: ProgressCallback) -> PhotogrammetryResult: ...
```

- `PhotogrammetryJobSpec` is engine-neutral: project and scan IDs, image storage keys, control-point keys, declared CRS and vertical datum, and a quality level.
- `PhotogrammetryResult` contains output storage keys, the output `crs` (`None` means an arbitrary local frame), units, engine name and version, and an engine report.
- Engines are selected with `PHOTOGRAMMETRY_ENGINE`. The default `none` engine raises a clear `EngineNotConfiguredError`, and the job fails permanently instead of fabricating output.

Candidate adapters (none is privileged by the interface):

| Adapter | Notes |
| --- | --- |
| COLMAP + OpenMVS | Open source, runs locally in a GPU container |
| OpenDroneMap / NodeODM | Open source, HTTP task API, good for drone imagery |
| Agisoft Metashape | Commercial, Python API, strong 360° support |
| RealityCapture / RealityScan | Commercial, CLI |
| Cloud services | Through an HTTP adapter |

## 360° images

The X5 produces dual-fisheye or equirectangular images. Most SfM engines expect perspective cameras, so `images.preprocess` reprojects each 360° frame into several overlapping perspective views (for example a cube map, or 6–8 virtual pinhole cameras) and records the virtual-camera rig. **A single 360° image provides no depth and is never treated as a point cloud.**

## Georeferencing

- With GNSS or ground control points and a declared CRS, the engine solves a georeferenced model, and the output `crs` is the declared CRS.
- Without them, the output stays in a local frame (`crs = null`, scale possibly arbitrary). The UI shows "Unknown CRS". A later explicit "georeference" job can transform it using control points, producing a new asset with lineage.
- No silent transformation between CRSs happens at any stage.

## Resource isolation

Workers run in separate containers with resource limits. GPU workers can be a separate deployment that subscribes to `photogrammetry.reconstruct` only, by registering only that handler. Input files are data only. Engines are invoked with argument arrays, never shell strings built from user input.
