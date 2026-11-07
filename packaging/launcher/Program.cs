using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace InertiaPOS.Launcher
{
    public class SplashScreen : Form
    {
        private Label _lblStatus;

        public SplashScreen()
        {
            this.FormBorderStyle = FormBorderStyle.None;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.Size = new Size(440, 220);
            this.BackColor = Color.FromArgb(15, 23, 42); // Dark slate (#0F172A)
            this.ShowInTaskbar = true;
            this.Text = "Inertia POS";
            this.TopMost = true;

            this.Paint += (s, e) =>
            {
                using (Pen pen = new Pen(Color.FromArgb(56, 189, 248), 2)) // Sky blue accent border
                {
                    e.Graphics.DrawRectangle(pen, 1, 1, this.Width - 2, this.Height - 2);
                }
            };

            Label lblTitle = new Label
            {
                Text = "INERTIA POS",
                Font = new Font("Segoe UI", 20, FontStyle.Bold),
                ForeColor = Color.White,
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Size = new Size(420, 40),
                Location = new Point(10, 30)
            };

            Label lblSubtitle = new Label
            {
                Text = "Offline Retail POS System",
                Font = new Font("Segoe UI", 10, FontStyle.Regular),
                ForeColor = Color.FromArgb(148, 163, 184),
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Size = new Size(420, 24),
                Location = new Point(10, 72)
            };

            ProgressBar pBar = new ProgressBar
            {
                Style = ProgressBarStyle.Marquee,
                MarqueeAnimationSpeed = 25,
                Size = new Size(340, 8),
                Location = new Point(50, 118)
            };

            _lblStatus = new Label
            {
                Text = "Starting up...",
                Font = new Font("Segoe UI", 9, FontStyle.Regular),
                ForeColor = Color.FromArgb(56, 189, 248),
                AutoSize = false,
                TextAlign = ContentAlignment.MiddleCenter,
                Size = new Size(420, 24),
                Location = new Point(10, 142)
            };

            this.Controls.Add(lblTitle);
            this.Controls.Add(lblSubtitle);
            this.Controls.Add(pBar);
            this.Controls.Add(_lblStatus);
        }

        public void SetStatus(string text)
        {
            try
            {
                if (this.InvokeRequired)
                {
                    this.BeginInvoke(new Action(() => SetStatus(text)));
                    return;
                }
                if (_lblStatus != null && !this.IsDisposed)
                {
                    _lblStatus.Text = text;
                }
            }
            catch { }
        }

        public void CloseSplash()
        {
            try
            {
                if (this.InvokeRequired)
                {
                    this.BeginInvoke(new Action(CloseSplash));
                    return;
                }
                this.Close();
                this.Dispose();
            }
            catch { }
        }
    }

    static class Program
    {
        private static Process _phpProcess = null;
        private static string _logFile = null;
        private static string _dataDir = null;

        private static void Log(string message)
        {
            try
            {
                if (!string.IsNullOrEmpty(_logFile))
                {
                    File.AppendAllText(_logFile, string.Format("[{0:yyyy-MM-dd HH:mm:ss}] {1}\r\n", DateTime.Now, message));
                }
            }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            _dataDir = Path.Combine(localAppData, "InertiaPOS");
            _logFile = Path.Combine(_dataDir, "launcher.log");

            // Auto-create or refresh Desktop shortcut on every launch
            EnsureDesktopShortcut(baseDir);

            bool isNewInstance;
            using (Mutex singleInstanceMutex = new Mutex(true, "Global\\InertiaPOS_Desktop_SingleInstance_Mutex", out isNewInstance))
            {
                if (!isNewInstance)
                {
                    // An instance of Inertia POS is already running. Re-open or bring the Edge app window to front!
                    Log("Inertia POS instance already running. Re-launching Edge app window...");
                    try
                    {
                        string portFile = Path.Combine(_dataDir, "port.txt");
                        int activePort = 8000;
                        if (File.Exists(portFile))
                        {
                            int parsed;
                            if (int.TryParse(File.ReadAllText(portFile).Trim(), out parsed) && parsed > 0)
                            {
                                activePort = parsed;
                            }
                        }

                        string edgeExe = FindEdgePath();
                        if (!string.IsNullOrEmpty(edgeExe) && File.Exists(edgeExe))
                        {
                            string edgeProfileDir = Path.Combine(_dataDir, "edge-profile");
                            string appUrl = string.Format("http://127.0.0.1:{0}", activePort);
                            ProcessStartInfo edgeStartInfo = new ProcessStartInfo
                            {
                                FileName = edgeExe,
                                Arguments = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --no-first-run --no-default-browser-check", appUrl, edgeProfileDir),
                                UseShellExecute = false
                            };
                            Process.Start(edgeStartInfo);
                            Log("Re-focused Edge app window for port " + activePort);
                        }
                    }
                    catch (Exception ex)
                    {
                        Log("Failed to re-focus Edge window: " + ex.Message);
                    }
                    return;
                }

                AppDomain.CurrentDomain.ProcessExit += (s, e) => CleanUpServer();

                // Show instant modern visual feedback
                SplashScreen splash = new SplashScreen();
                Thread splashThread = new Thread(() => Application.Run(splash));
                splashThread.SetApartmentState(ApartmentState.STA);
                splashThread.IsBackground = true;
                splashThread.Start();

                int handleWait = 0;
                while (!splash.IsHandleCreated && handleWait < 20)
                {
                    Thread.Sleep(50);
                    handleWait++;
                }

                try
                {
                    splash.SetStatus("Initializing offline storage...");
                    EnsureDirectory(_dataDir);
                    string dbDir = Path.Combine(_dataDir, "database");
                    string dbFile = Path.Combine(dbDir, "database.sqlite");
                    string storageDir = Path.Combine(_dataDir, "storage");

                    Log("=== Inertia POS Launcher Started ===");
                    Log("Base directory: " + baseDir);
                    Log("Data directory: " + _dataDir);

                    // 1. Locate bundled PHP
                    splash.SetStatus("Checking PHP runtime environment...");
                    string phpExe = Path.Combine(baseDir, @"runtime\php\php.exe");
                    string phpIni = Path.Combine(baseDir, @"runtime\php\php.ini");

                    if (!File.Exists(phpExe))
                    {
                        // Fallback search locations
                        if (File.Exists(Path.Combine(baseDir, @"php\php.exe")))
                        {
                            phpExe = Path.Combine(baseDir, @"php\php.exe");
                            phpIni = Path.Combine(baseDir, @"php\php.ini");
                        }
                        else if (File.Exists(@"C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64\php.exe"))
                        {
                            // Development fallback
                            phpExe = @"C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64\php.exe";
                            phpIni = @"C:\laragon\bin\php\php-8.4.16-nts-Win32-vs17-x64\php.ini";
                        }
                        else
                        {
                            splash.CloseSplash();
                            Log("ERROR: Bundled PHP runtime could not be located.");
                            MessageBox.Show("Bundled PHP runtime could not be located.\nPlease reinstall Inertia POS.",
                                "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                            return;
                        }
                    }
                    Log("Using PHP runtime: " + phpExe);

                    // 2. Locate Laravel application
                    string appDir = Path.Combine(baseDir, "app");
                    if (!Directory.Exists(appDir) && File.Exists(Path.Combine(baseDir, "artisan")))
                    {
                        appDir = baseDir; // Portable / root mode
                    }

                    string publicDir = Path.Combine(appDir, "public");
                    string serverScript = Path.Combine(appDir, @"vendor\laravel\framework\src\Illuminate\Foundation\resources\server.php");

                    if (!Directory.Exists(publicDir) || !File.Exists(serverScript))
                    {
                        splash.CloseSplash();
                        Log("ERROR: Application resources missing in " + appDir);
                        MessageBox.Show("Application resources are missing.\nPlease reinstall Inertia POS.",
                            "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }
                    Log("Using Laravel app: " + appDir);

                    EnsureDirectory(dbDir);
                    EnsureDirectory(Path.Combine(storageDir, @"app\public"));
                    EnsureDirectory(Path.Combine(storageDir, @"framework\cache\data"));
                    EnsureDirectory(Path.Combine(storageDir, @"framework\sessions"));
                    EnsureDirectory(Path.Combine(storageDir, @"framework\views"));
                    EnsureDirectory(Path.Combine(storageDir, "logs"));

                    // Initialize SQLite database file if fresh
                    bool isFreshDb = !File.Exists(dbFile);
                    if (isFreshDb)
                    {
                        Log("Creating empty SQLite database: " + dbFile);
                        File.Create(dbFile).Close();
                        splash.SetStatus("Setting up offline database & tables (first-time setup)...");
                    }
                    else
                    {
                        splash.SetStatus("Checking database integrity...");
                    }

                    // 4. Safe idempotent migration / preparation (never migrate:fresh, never delete data)
                    Log("Running idempotent migration check...");
                    RunSilentProcess(phpExe, phpIni, appDir, dbFile, storageDir, "artisan migrate --force --no-interaction");
                    Log("Migration check finished.");

                    // 5. Select local port (127.0.0.1 only)
                    splash.SetStatus("Starting local POS engine...");
                    int port = FindAvailablePort(8000);
                    if (port == 0)
                    {
                        splash.CloseSplash();
                        Log("ERROR: No available local network ports were found (8000-8050).");
                        MessageBox.Show("No available local network ports were found (8000-8050).",
                            "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }

                    string posUrl = string.Format("http://127.0.0.1:{0}", port);
                    Log("Selected local port: " + port + " (" + posUrl + ")");

                    // Save port for secondary launches
                    try
                    {
                        File.WriteAllText(Path.Combine(_dataDir, "port.txt"), port.ToString());
                    }
                    catch { }

                    // 6. Launch PHP Web Server in Background (No Window)
                    ProcessStartInfo phpStartInfo = new ProcessStartInfo
                    {
                        FileName = phpExe,
                        Arguments = string.Format("-c \"{0}\" -S 127.0.0.1:{1} \"{2}\"", phpIni, port, serverScript),
                        WorkingDirectory = publicDir,
                        CreateNoWindow = true,
                        UseShellExecute = false,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };

                    phpStartInfo.EnvironmentVariables["DB_DATABASE"] = dbFile;
                    phpStartInfo.EnvironmentVariables["APP_STORAGE_PATH"] = storageDir;
                    phpStartInfo.EnvironmentVariables["APP_ENV"] = "production";
                    phpStartInfo.EnvironmentVariables["APP_DEBUG"] = "false";
                    phpStartInfo.EnvironmentVariables["APP_URL"] = posUrl;

                    _phpProcess = Process.Start(phpStartInfo);
                    Log("Spawned PHP server with PID: " + (_phpProcess != null ? _phpProcess.Id.ToString() : "null"));

                    // 7. Wait until server responds
                    splash.SetStatus("Connecting to POS service...");
                    Log("Waiting for server ready on " + posUrl + "/up ...");
                    if (!WaitForServerReady(posUrl, 25000))
                    {
                        splash.CloseSplash();
                        Log("ERROR: POS local server failed to initialize within 25 seconds.");
                        CleanUpServer();
                        MessageBox.Show("The POS local server failed to initialize within 25 seconds.",
                            "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }
                    Log("Server is ready and responding.");

                    // 8. Locate Microsoft Edge
                    string edgeExe = FindEdgePath();
                    if (string.IsNullOrEmpty(edgeExe) || !File.Exists(edgeExe))
                    {
                        splash.CloseSplash();
                        Log("ERROR: Microsoft Edge not found.");
                        CleanUpServer();
                        MessageBox.Show("Microsoft Edge was not detected on this computer.\nMicrosoft Edge is required to run the Inertia POS application window.",
                            "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        return;
                    }
                    Log("Using Microsoft Edge: " + edgeExe);

                    // 9. Launch Edge in App Mode with isolated profile
                    splash.SetStatus("Opening POS window...");
                    string edgeProfileDir = Path.Combine(_dataDir, "edge-profile");
                    ProcessStartInfo edgeStartInfo = new ProcessStartInfo
                    {
                        FileName = edgeExe,
                        Arguments = string.Format("--app=\"{0}\" --user-data-dir=\"{1}\" --no-first-run --no-default-browser-check", posUrl, edgeProfileDir),
                        UseShellExecute = false
                    };

                    Log("Starting Edge in app mode...");
                    Process edgeProcess = Process.Start(edgeStartInfo);
                    Log("Edge process started. Monitoring window lifecycle...");

                    // Give Edge 2 seconds to render its window, then close splash screen smoothly
                    Thread.Sleep(2000);
                    splash.CloseSplash();

                    // 10. Robust process tracking: monitor until the Edge App Window closes
                    int absentSeconds = 0;
                    while (true)
                    {
                        Thread.Sleep(1000);
                        if (!IsEdgeAppWindowRunning(port))
                        {
                            absentSeconds++;
                            if (absentSeconds >= 3)
                            {
                                Log("Edge application window closed by user.");
                                break;
                            }
                        }
                        else
                        {
                            absentSeconds = 0;
                        }
                    }

                    CleanUpServer();
                    Log("=== Inertia POS Launcher Exited Cleanly ===");
                }
                catch (Exception ex)
                {
                    splash.CloseSplash();
                    Log("EXCEPTION: " + ex.ToString());
                    CleanUpServer();
                    MessageBox.Show("An unexpected error occurred while running Inertia POS:\n\n" + ex.Message,
                        "Inertia POS Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        private static void CleanUpServer()
        {
            try
            {
                if (_phpProcess != null && !_phpProcess.HasExited)
                {
                    _phpProcess.Kill();
                    _phpProcess.Dispose();
                    _phpProcess = null;
                }
            }
            catch { }

            try
            {
                if (!string.IsNullOrEmpty(_dataDir))
                {
                    string portFile = Path.Combine(_dataDir, "port.txt");
                    if (File.Exists(portFile))
                    {
                        File.Delete(portFile);
                    }

                    // Clean up any lingering Edge background helpers for our isolated profile
                    KillProfileHelpers(_dataDir);
                }
            }
            catch { }
        }

        private static void KillProfileHelpers(string dataDir)
        {
            try
            {
                string profileTag = Path.Combine(dataDir, "edge-profile");
                using (var searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'msedge.exe'"))
                {
                    foreach (var obj in searcher.Get())
                    {
                        string cmd = obj["CommandLine"] as string;
                        if (!string.IsNullOrEmpty(cmd) && cmd.IndexOf(profileTag, StringComparison.OrdinalIgnoreCase) >= 0)
                        {
                            uint pid = (uint)obj["ProcessId"];
                            try
                            {
                                Process p = Process.GetProcessById((int)pid);
                                p.Kill();
                            }
                            catch { }
                        }
                    }
                }
            }
            catch { }
        }

        private static void EnsureDirectory(string dir)
        {
            if (!Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
        }

        private static int FindAvailablePort(int startPort)
        {
            for (int port = startPort; port <= startPort + 50; port++)
            {
                try
                {
                    TcpListener listener = new TcpListener(IPAddress.Loopback, port);
                    listener.Start();
                    listener.Stop();
                    return port;
                }
                catch
                {
                    // Port is in use, try next
                }
            }
            return 0;
        }

        private static bool WaitForServerReady(string url, int timeoutMs)
        {
            string healthUrl = url.TrimEnd('/') + "/up";
            Stopwatch sw = Stopwatch.StartNew();

            while (sw.ElapsedMilliseconds < timeoutMs)
            {
                try
                {
                    HttpWebRequest request = (HttpWebRequest)WebRequest.Create(healthUrl);
                    request.Timeout = 1000;
                    request.Method = "GET";

                    using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                    {
                        if (response.StatusCode == HttpStatusCode.OK)
                        {
                            return true;
                        }
                    }
                }
                catch
                {
                    Thread.Sleep(150);
                }
            }

            return false;
        }

        private static void RunSilentProcess(string phpExe, string phpIni, string appDir, string dbFile, string storageDir, string commandArgs)
        {
            try
            {
                Log("RunSilentProcess starting: " + commandArgs);
                ProcessStartInfo psi = new ProcessStartInfo
                {
                    FileName = phpExe,
                    Arguments = string.Format("-c \"{0}\" {1}", phpIni, commandArgs),
                    WorkingDirectory = appDir,
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                psi.EnvironmentVariables["DB_DATABASE"] = dbFile;
                psi.EnvironmentVariables["APP_STORAGE_PATH"] = storageDir;
                psi.EnvironmentVariables["APP_ENV"] = "production";
                psi.EnvironmentVariables["APP_DEBUG"] = "false";

                using (Process proc = Process.Start(psi))
                {
                    if (proc != null)
                    {
                        bool finished = proc.WaitForExit(90000);
                        if (finished)
                        {
                            Log(string.Format("RunSilentProcess finished with exit code {0}.", proc.ExitCode));
                        }
                        else
                        {
                            Log("WARNING: RunSilentProcess timed out after 90s.");
                            try { proc.Kill(); } catch { }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log("RunSilentProcess Exception: " + ex.Message);
            }
        }

        private static string FindEdgePath()
        {
            // Standard 64-bit Program Files (x86) location
            string p86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
            string path1 = Path.Combine(p86, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(path1)) return path1;

            // 64-bit Program Files location
            string p64 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string path2 = Path.Combine(p64, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(path2)) return path2;

            // Local AppData location
            string localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string path3 = Path.Combine(localApp, @"Microsoft\Edge\Application\msedge.exe");
            if (File.Exists(path3)) return path3;

            // Windows Registry App Paths lookup
            try
            {
                using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    if (key != null)
                    {
                        object val = key.GetValue(null);
                        if (val != null && File.Exists(val.ToString()))
                        {
                            return val.ToString();
                        }
                    }
                }
            }
            catch { }

            return null;
        }

        private static bool IsEdgeAppWindowRunning(int port)
        {
            try
            {
                string portPattern = ":" + port.ToString();
                using (var searcher = new System.Management.ManagementObjectSearcher(
                    "SELECT CommandLine FROM Win32_Process WHERE Name = 'msedge.exe'"))
                {
                    foreach (var obj in searcher.Get())
                    {
                        string cmd = obj["CommandLine"] as string;
                        if (!string.IsNullOrEmpty(cmd))
                        {
                            // In Chromium, the active application window has --app= and DOES NOT have --type=
                            bool hasApp = cmd.IndexOf("--app=", StringComparison.OrdinalIgnoreCase) >= 0;
                            bool hasType = cmd.IndexOf("--type=", StringComparison.OrdinalIgnoreCase) >= 0;
                            bool hasPort = cmd.IndexOf(portPattern, StringComparison.OrdinalIgnoreCase) >= 0;

                            if (hasApp && !hasType && hasPort)
                            {
                                return true;
                            }
                        }
                    }
                }
            }
            catch { }
            return false;
        }

        private static void EnsureDesktopShortcut(string baseDir)
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string lnkPath = Path.Combine(desktop, "Inertia POS.lnk");
                string exePath = Path.Combine(baseDir, "InertiaPOS.exe");

                if (File.Exists(exePath))
                {
                    Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                    if (shellType != null)
                    {
                        dynamic shell = Activator.CreateInstance(shellType);
                        dynamic shortcut = shell.CreateShortcut(lnkPath);
                        shortcut.TargetPath = exePath;
                        shortcut.WorkingDirectory = baseDir;
                        shortcut.Description = "Inertia POS Desktop Application";
                        shortcut.Save();
                        Log("Desktop shortcut verified/created: " + lnkPath);
                    }
                }
            }
            catch (Exception ex)
            {
                Log("Desktop shortcut setup skipped: " + ex.Message);
            }
        }
    }
}
