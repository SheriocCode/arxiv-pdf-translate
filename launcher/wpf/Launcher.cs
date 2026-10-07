using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace ArxivPdfTranslateWpf
{
    // Shared paths and local-service control for the WPF launcher.
    internal static class Launcher
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunName = "BrowserPDFTranslate";
        private const string ShortcutName = "Arxiv PDF Translate.lnk";

        private static bool resolved;

        public static string ProjectDir { get; private set; }
        public static string ServerDir { get; private set; }
        public static string ServerScript { get; private set; }
        public static string Python { get; private set; }
        public static string LogFile { get; private set; }
        public static int Port { get; private set; }
        public static string HealthUrl { get; private set; }
        public static Process Server { get; set; }

        public static string ExePath
        {
            get { return Assembly.GetExecutingAssembly().Location; }
        }

        public static void ResolvePaths()
        {
            if (resolved)
            {
                return;
            }
            resolved = true;

            string exeDir = Path.GetDirectoryName(ExePath);
            string root = FindProjectRoot(exeDir);
            ProjectDir = root ?? Path.GetFullPath(Path.Combine(exeDir, ".."));
            ServerDir = Path.Combine(ProjectDir, "server");
            ServerScript = Path.Combine(ServerDir, "server.py");
            LogFile = Path.Combine(ServerDir, "server.log");
            Port = ReadPort(Path.Combine(ServerDir, "config.json"), 8760);
            HealthUrl = "http://127.0.0.1:" + Port + "/health";

            string bundled = Path.Combine(ProjectDir, "engine", "runtime", "python.exe");
            Python = File.Exists(bundled) ? bundled : "python";
        }

        private static string FindProjectRoot(string start)
        {
            string dir = start;
            for (int i = 0; i < 8 && !string.IsNullOrEmpty(dir); i++)
            {
                if (File.Exists(Path.Combine(dir, "server", "server.py")))
                {
                    return dir;
                }
                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }
            return null;
        }

        private static int ReadPort(string configPath, int fallback)
        {
            try
            {
                if (File.Exists(configPath))
                {
                    Match m = Regex.Match(File.ReadAllText(configPath), "\"port\"\\s*:\\s*(\\d+)");
                    if (m.Success)
                    {
                        return int.Parse(m.Groups[1].Value);
                    }
                }
            }
            catch
            {
                /* keep fallback */
            }
            return fallback;
        }

        public static bool HasArg(string[] args, string name)
        {
            if (args == null)
            {
                return false;
            }
            foreach (string arg in args)
            {
                if (string.Equals(arg, name, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        private static ProcessStartInfo StartInfo(bool redirect)
        {
            var info = new ProcessStartInfo(Python, "\"" + ServerScript + "\"")
            {
                WorkingDirectory = ServerDir,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            if (redirect)
            {
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
            }
            return info;
        }

        public static void StartServerDetached()
        {
            ResolvePaths();
            if (IsServerUp())
            {
                return;
            }
            try
            {
                Process.Start(StartInfo(false));
            }
            catch
            {
                /* ignore */
            }
        }

        public static bool IsServerUp()
        {
            try
            {
                var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(HealthUrl);
                request.Timeout = 1200;
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

        public static void LogLine(string line)
        {
            if (line == null)
            {
                return;
            }
            string text = line.StartsWith("[")
                ? line
                : "[" + DateTime.Now.ToString("HH:mm:ss") + "] " + line;
            try
            {
                File.AppendAllText(LogFile, text + Environment.NewLine);
            }
            catch
            {
                /* ignore */
            }
        }

        public static void StartServer(Action<string> onLine)
        {
            ResolvePaths();
            if (IsServerUp())
            {
                return;
            }
            try
            {
                var info = StartInfo(true);
                var proc = new Process { StartInfo = info, EnableRaisingEvents = true };
                proc.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        LogLine(e.Data);
                        if (onLine != null) { onLine(e.Data); }
                    }
                };
                proc.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null)
                    {
                        LogLine(e.Data);
                        if (onLine != null) { onLine(e.Data); }
                    }
                };
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                Server = proc;
            }
            catch
            {
                Server = null;
            }
        }

        public static void StopServer()
        {
            if (Server != null && !Server.HasExited)
            {
                try { Server.Kill(); } catch { /* ignore */ }
            }
            Server = null;

            try
            {
                var query = new ManagementObjectSearcher(
                    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='python.exe' OR Name='pythonw.exe'");
                foreach (ManagementObject item in query.Get())
                {
                    string commandLine = item["CommandLine"] as string;
                    if (commandLine != null &&
                        commandLine.IndexOf("server.py", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        int pid = Convert.ToInt32(item["ProcessId"]);
                        try { Process.GetProcessById(pid).Kill(); } catch { /* ignore */ }
                    }
                }
            }
            catch
            {
                /* ignore */
            }
        }

        public static bool IsAutostart()
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, false))
            {
                return key != null && key.GetValue(RunName) != null;
            }
        }

        public static void SetAutostart(bool enabled)
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (key == null)
                {
                    return;
                }
                if (enabled)
                {
                    key.SetValue(RunName, "\"" + ExePath + "\"");
                }
                else
                {
                    key.DeleteValue(RunName, false);
                }
            }
        }

        public static void CreateShortcut()
        {
            try
            {
                string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string path = Path.Combine(desktop, ShortcutName);
                object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                object link = shell.GetType().InvokeMember(
                    "CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { path });
                Type linkType = link.GetType();
                linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] { ExePath });
                linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] { ProjectDir });
                linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] { "Arxiv PDF Translate" });
                linkType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] { ExePath });
                linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
            }
            catch
            {
                /* ignore */
            }
        }

        // ---- server/config.json access -------------------------------------

        public static string ConfigPath
        {
            get { return Path.Combine(ServerDir, "config.json"); }
        }

        public static Dictionary<string, object> ReadConfig()
        {
            try
            {
                if (File.Exists(ConfigPath))
                {
                    var serializer = new JavaScriptSerializer();
                    Dictionary<string, object> config =
                        serializer.Deserialize<Dictionary<string, object>>(File.ReadAllText(ConfigPath));
                    if (config != null)
                    {
                        return config;
                    }
                }
            }
            catch
            {
                /* fall through to empty */
            }
            return new Dictionary<string, object>();
        }

        public static bool WriteConfig(Dictionary<string, object> config)
        {
            try
            {
                var serializer = new JavaScriptSerializer();
                string json = serializer.Serialize(config);
                File.WriteAllText(ConfigPath, json, new UTF8Encoding(false));
                return true;
            }
            catch
            {
                return false;
            }
        }

        public static string GetStr(Dictionary<string, object> config, string key, string fallback)
        {
            object value;
            if (config != null && config.TryGetValue(key, out value) && value != null)
            {
                return Convert.ToString(value);
            }
            return fallback;
        }

        public static void RefreshPort()
        {
            Port = ReadPort(ConfigPath, Port > 0 ? Port : 8760);
            HealthUrl = "http://127.0.0.1:" + Port + "/health";
        }

        public static string BaseUrl()
        {
            return "http://127.0.0.1:" + Port;
        }

        public static string HttpGet(string url, int timeoutMs)
        {
            try
            {
                var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
                request.Timeout = timeoutMs;
                using (var response = (System.Net.HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    return reader.ReadToEnd();
                }
            }
            catch
            {
                return null;
            }
        }

        public static string ReadLogTail(int maxLines)
        {
            try
            {
                if (!File.Exists(LogFile))
                {
                    return "（暂无日志）";
                }
                string[] lines = File.ReadAllLines(LogFile);
                int start = Math.Max(0, lines.Length - maxLines);
                var builder = new StringBuilder();
                for (int i = start; i < lines.Length; i++)
                {
                    builder.AppendLine(lines[i]);
                }
                return builder.ToString();
            }
            catch (Exception err)
            {
                return "（读取日志失败：" + err.Message + "）";
            }
        }
    }
}
