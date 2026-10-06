// Arxiv PDF Translate - tray control panel (.NET WinForms, single .exe).
// Build with launcher/build-launcher.bat
//
//   ArxivPdfTranslate.exe            tray app (starts the service, menu)
//   ArxivPdfTranslate.exe --server   start the local service only, then exit
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class Program
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunName = "BrowserPDFTranslate";
    private const string ShortcutName = "Arxiv PDF Translate.lnk";

    private static NotifyIcon tray;
    private static ToolStripMenuItem miStart, miStop, miAuto;
    private static Process server;
    private static Mutex mutex;
    private static Form logWindow;

    private static string projectDir, serverDir, serverScript, python, logFile;
    private static int port = 8760;
    private static string healthUrl;

    [STAThread]
    private static void Main(string[] args)
    {
        ResolvePaths();

        if (HasArg(args, "--server")) { StartServerDetached(); return; }

        bool createdNew;
        mutex = new Mutex(true, "ArxivPdfTranslateTrayApp", out createdNew);
        if (!createdNew) { return; }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        tray = new NotifyIcon { Icon = LoadIcon(), Visible = true, Text = "Arxiv PDF Translate" };

        var menu = new ContextMenuStrip();
        miStart = new ToolStripMenuItem("启动服务");
        miStop = new ToolStripMenuItem("停止服务");
        miAuto = new ToolStripMenuItem("开机自启") { CheckOnClick = true, Checked = IsAutostart() };
        var miShortcut = new ToolStripMenuItem("创建桌面快捷方式");
        var miLog = new ToolStripMenuItem("查看日志");
        var miExit = new ToolStripMenuItem("退出");
        menu.Items.Add(miStart);
        menu.Items.Add(miStop);
        menu.Items.Add(miAuto);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(miShortcut);
        menu.Items.Add(miLog);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(miExit);
        tray.ContextMenuStrip = menu;

        // Left click and right click both open the menu.
        tray.MouseClick += delegate(object s, MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left) { menu.Show(Cursor.Position); }
        };

        miStart.Click += delegate { StartServer(); UpdateStatus(); };
        miStop.Click += delegate { StopServer(); UpdateStatus(); };
        miAuto.Click += delegate { SetAutostart(miAuto.Checked); };
        miShortcut.Click += delegate { CreateShortcut(); };
        miLog.Click += delegate { ShowLogWindow(); };
        miExit.Click += delegate { tray.Visible = false; StopServer(); Application.Exit(); };

        var timer = new System.Windows.Forms.Timer { Interval = 3000 };
        timer.Tick += delegate { UpdateStatus(); };
        timer.Start();

        UpdateStatus();
        StartServer();
        UpdateStatus();

        Application.Run();
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase)) { return true; }
        }
        return false;
    }

    private static string ExePath
    {
        get { return Assembly.GetExecutingAssembly().Location; }
    }

    private static void ResolvePaths()
    {
        string exeDir = Path.GetDirectoryName(ExePath);
        projectDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
        serverDir = Path.Combine(projectDir, "server");
        serverScript = Path.Combine(serverDir, "pdf2zh_server.py");
        logFile = Path.Combine(serverDir, "server.log");

        string bundled = Path.Combine(projectDir, "pdf2zh", "runtime", "python.exe");
        python = File.Exists(bundled) ? bundled : "python";

        try
        {
            string cfg = Path.Combine(serverDir, "config.json");
            if (File.Exists(cfg))
            {
                Match m = Regex.Match(File.ReadAllText(cfg), "\"port\"\\s*:\\s*(\\d+)");
                if (m.Success) { port = int.Parse(m.Groups[1].Value); }
            }
        }
        catch { /* keep default */ }

        healthUrl = "http://127.0.0.1:" + port + "/health";
    }

    private static Icon LoadIcon()
    {
        try
        {
            Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("appicon.ico");
            if (stream != null) { return new Icon(stream); }
        }
        catch { /* fall through */ }
        return SystemIcons.Application;
    }

    private static bool IsServerUp()
    {
        try
        {
            var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(healthUrl);
            request.Timeout = 1000;
            using (var response = (System.Net.HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode == 200;
            }
        }
        catch
        {
            return false;
        }
    }

    private static ProcessStartInfo ServerStartInfo()
    {
        return new ProcessStartInfo(python, "\"" + serverScript + "\"")
        {
            WorkingDirectory = serverDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
    }

    private static void StartServerDetached()
    {
        if (IsServerUp()) { return; }
        try { Process.Start(ServerStartInfo()); } catch { }
    }

    private static void StartServer()
    {
        if (IsServerUp()) { return; }
        LogLine("[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] [tray] starting service (port " + port + ")");
        try
        {
            var info = ServerStartInfo();
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            server = new Process { StartInfo = info, EnableRaisingEvents = true };
            server.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { LogLine(e.Data); };
            server.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { LogLine(e.Data); };
            server.Start();
            server.BeginOutputReadLine();
            server.BeginErrorReadLine();
        }
        catch
        {
            server = null;
        }
    }

    private static void StopServer()
    {
        if (server != null && !server.HasExited)
        {
            try { server.Kill(); } catch { }
        }
        server = null;

        try
        {
            var query = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='python.exe' OR Name='pythonw.exe'");
            foreach (ManagementObject item in query.Get())
            {
                string commandLine = item["CommandLine"] as string;
                if (commandLine != null &&
                    commandLine.IndexOf("pdf2zh_server.py", StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    int pid = Convert.ToInt32(item["ProcessId"]);
                    try { Process.GetProcessById(pid).Kill(); } catch { }
                }
            }
        }
        catch { /* ignore */ }
    }

    private static void LogLine(string line)
    {
        if (line == null) { return; }
        string text = line.StartsWith("[")
            ? line
            : "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line;
        try { File.AppendAllText(logFile, text + Environment.NewLine); } catch { }
    }

    private static void UpdateStatus()
    {
        bool up = IsServerUp();
        tray.Text = up
            ? "Arxiv PDF Translate · 在线 (端口 " + port + ")"
            : "Arxiv PDF Translate · 未启动";
        miStart.Enabled = !up;
        miStop.Enabled = up;
    }

    /* -- log window -------------------------------------------------------- */

    private static string ReadLogTail(int maxLines)
    {
        try
        {
            if (!File.Exists(logFile)) { return "（暂无日志）"; }
            string[] lines = File.ReadAllLines(logFile);
            int start = Math.Max(0, lines.Length - maxLines);
            var builder = new StringBuilder();
            for (int i = start; i < lines.Length; i++) { builder.AppendLine(lines[i]); }
            return builder.ToString();
        }
        catch (Exception err)
        {
            return "（读取日志失败：" + err.Message + "）";
        }
    }

    private static void ShowLogWindow()
    {
        if (logWindow != null && !logWindow.IsDisposed)
        {
            logWindow.Activate();
            return;
        }

        var box = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            WordWrap = false,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 9F),
            BackColor = Color.FromArgb(18, 18, 18),
            ForeColor = Color.Gainsboro,
            BorderStyle = BorderStyle.None,
        };

        var form = new Form
        {
            Text = "Arxiv PDF Translate · 日志",
            Width = 780,
            Height = 480,
            StartPosition = FormStartPosition.CenterScreen,
            BackColor = Color.FromArgb(18, 18, 18),
            ShowIcon = false,
        };
        form.Controls.Add(box);

        var refresh = new System.Windows.Forms.Timer { Interval = 1000 };
        refresh.Tick += delegate
        {
            string text = ReadLogTail(400);
            if (box.Text != text)
            {
                box.Text = text;
                box.SelectionStart = box.TextLength;
                box.ScrollToCaret();
            }
        };
        form.FormClosed += delegate { refresh.Stop(); refresh.Dispose(); };

        box.Text = ReadLogTail(400);
        box.SelectionStart = box.TextLength;
        box.ScrollToCaret();
        refresh.Start();

        logWindow = form;
        form.Show();
    }

    /* -- system integration ------------------------------------------------ */

    private static string ShortcutPath()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        return Path.Combine(desktop, ShortcutName);
    }

    private static void CreateShortcut()
    {
        try
        {
            object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
            object link = shell.GetType().InvokeMember(
                "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { ShortcutPath() });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { ExePath });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { projectDir });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Arxiv PDF Translate" });
            linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { ExePath });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        }
        catch { /* ignore */ }
    }

    private static bool IsAutostart()
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
        {
            return key != null && key.GetValue(RunName) != null;
        }
    }

    private static void SetAutostart(bool enabled)
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, true))
        {
            if (key == null) { return; }
            if (enabled) { key.SetValue(RunName, "\"" + ExePath + "\""); }
            else { key.DeleteValue(RunName, false); }
        }
    }
}
