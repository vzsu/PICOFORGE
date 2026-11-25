// ForgeEngine/SandboxJob.cs — Windows job object around one sandbox child (docs/04 §8: "OS-level limits
// (Windows job object with memory and process limits)"). The host's 250 ms RSS poll is the friendly
// guard; the job is the hard backstop the OS enforces between polls (ENG-MEM-01 saw a 282 MiB peak
// against a 200 MiB cap). Host-side P/Invoke only — the analyzer bans interop in generated code.

using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ForgeEngine;

internal sealed class SandboxJob : IDisposable
{
    /// <summary>Hard commit cap = RSS cap × 1.25, so the poll (with its clear message) usually fires first.</summary>
    public const double HeadroomFactor = 1.25;

    private readonly IntPtr _handle;
    private bool _disposed;

    public long MemLimitMiB { get; }
    /// <summary>No child processes: the sandbox itself is the only process in its job.</summary>
    public const int ActiveProcessLimit = 1;

    private SandboxJob(IntPtr handle, long memLimitMiB)
    {
        _handle = handle;
        MemLimitMiB = memLimitMiB;
    }

    /// <summary>Creates the job, or null off Windows. Throws Win32Exception if Windows refuses.</summary>
    public static SandboxJob? Create(long rssCapMiB)
    {
        if (!OperatingSystem.IsWindows()) return null;
        var limitMiB = (long)Math.Round(rssCapMiB * HeadroomFactor);
        var handle = NativeMethods.CreateJobObjectW(IntPtr.Zero, IntPtr.Zero);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastPInvokeError());
        var info = new NativeMethods.JobObjectExtendedLimitInformation
        {
            BasicLimitInformation = new NativeMethods.JobObjectBasicLimitInformation
            {
                LimitFlags = NativeMethods.JobObjectLimitProcessMemory
                    | NativeMethods.JobObjectLimitActiveProcess
                    | NativeMethods.JobObjectLimitKillOnJobClose
                    | NativeMethods.JobObjectLimitDieOnUnhandledException,
                ActiveProcessLimit = (uint)ActiveProcessLimit,
            },
            ProcessMemoryLimit = checked((UIntPtr)(ulong)(limitMiB * 1024 * 1024)),
        };
        if (!NativeMethods.SetInformationJobObject(handle, NativeMethods.JobObjectExtendedLimitInformationClass,
                ref info, (uint)Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>()))
        {
            var e = Marshal.GetLastPInvokeError();
            NativeMethods.CloseHandle(handle);
            throw new Win32Exception(e);
        }
        return new SandboxJob(handle, limitMiB);
    }

    public void Assign(Process child)
    {
        ArgumentNullException.ThrowIfNull(child);
        if (!NativeMethods.AssignProcessToJobObject(_handle, child.Handle))
            throw new Win32Exception(Marshal.GetLastPInvokeError());
    }

    /// <summary>Peak committed memory of any process in the job, MiB (0 if unknown).</summary>
    public double PeakProcessMemoryMiB
    {
        get
        {
            if (!NativeMethods.QueryInformationJobObject(_handle, NativeMethods.JobObjectExtendedLimitInformationClass,
                    out var info, (uint)Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>(), IntPtr.Zero))
                return 0;
            return info.PeakProcessMemoryUsed.ToUInt64() / 1048576.0;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        NativeMethods.CloseHandle(_handle);   // KILL_ON_JOB_CLOSE: nothing outlives the job
    }

    private static class NativeMethods
    {
        public const int JobObjectExtendedLimitInformationClass = 9;
        public const uint JobObjectLimitActiveProcess = 0x00000008;
        public const uint JobObjectLimitProcessMemory = 0x00000100;
        public const uint JobObjectLimitDieOnUnhandledException = 0x00000400;
        public const uint JobObjectLimitKillOnJobClose = 0x00002000;

        [StructLayout(LayoutKind.Sequential)]
        internal struct JobObjectBasicLimitInformation
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct IoCounters
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        internal struct JobObjectExtendedLimitInformation
        {
            public JobObjectBasicLimitInformation BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        public static extern IntPtr CreateJobObjectW(IntPtr lpJobAttributes, IntPtr lpName);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass,
            ref JobObjectExtendedLimitInformation info, uint cbInfo);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass,
            out JobObjectExtendedLimitInformation info, uint cbInfo, IntPtr returnLength);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll", SetLastError = true, ExactSpelling = true)]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr handle);
    }
}
