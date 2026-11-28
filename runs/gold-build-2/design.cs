using PicoGK;
using PicoForge.Kit;
public static class Design {
    public static PicoGK.Voxels voxBuild(PicoForge.Kit.Ctx ctx) {
        return new PicoGK.Voxels(ctx.fVoxelMM);
    }
}