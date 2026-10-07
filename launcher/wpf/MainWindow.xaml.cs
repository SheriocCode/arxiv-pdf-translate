using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using System.Windows.Forms;
using ComboBox = System.Windows.Controls.ComboBox;

namespace ArxivPdfTranslateWpf
{
    public partial class MainWindow : Window
    {
        private NotifyIcon tray;
        private ContextMenuStrip menu;
        private ToolStripMenuItem miStart, miStop, miAuto;
        private DispatcherTimer timer;
        private bool exiting;

        private readonly JavaScriptSerializer serializer = new JavaScriptSerializer();
        private string lastJobsSig = "";
        private string lastBlockJobId = "";
        private int lastBlockCount = -1;

        private static readonly SolidColorBrush DotOn = new SolidColorBrush(Color.FromRgb(0x22, 0xC5, 0x5E));
        private static readonly SolidColorBrush DotOff = new SolidColorBrush(Color.FromRgb(0xF8, 0x71, 0x71));
        private static readonly SolidColorBrush OkBrush = new SolidColorBrush(Color.FromRgb(0x4A, 0xDE, 0x80));
        private static readonly SolidColorBrush ErrBrush = new SolidColorBrush(Color.FromRgb(0xF8, 0x71, 0x71));
        private static readonly SolidColorBrush MutedBrush = new SolidColorBrush(Color.FromRgb(0x8B, 0x8B, 0x8B));

        private static readonly string[] LangCodes =
        {
            "auto", "en", "zh-CN", "zh-TW", "ja", "ko", "fr", "de", "es", "ru", "pt", "it", "ar"
        };

        private static readonly string[] LangNames =
        {
            "自动检测", "英语", "简体中文", "繁体中文", "日语", "韩语", "法语", "德语", "西班牙语", "俄语", "葡萄牙语", "意大利语", "阿拉伯语"
        };

        public MainWindow()
        {
            InitializeComponent();
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            Launcher.ResolvePaths();
            LoadWindowIcon();
            SetupTray();

            PopulateLangs();
            LoadConfigForm();

            JobCombo.SelectionChanged += delegate { LoadBlocksForSelected(); };

            AutoCheck.IsChecked = Launcher.IsAutostart();
            timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1500) };
            timer.Tick += delegate { UpdateStatus(); RefreshLog(); RefreshJobs(); };
            timer.Start();

            Launcher.StartServer(null);
            UpdateStatus();
            RefreshLog();
        }

        private void LoadWindowIcon()
        {
            try
            {
                string ico = Path.Combine(Launcher.ProjectDir, "icons", "icon.ico");
                if (File.Exists(ico))
                {
                    Icon = new BitmapImage(new Uri(ico));
                }
            }
            catch
            {
                /* ignore */
            }
        }

        private void SetupTray()
        {
            System.Drawing.Icon trayIcon = System.Drawing.SystemIcons.Application;
            try
            {
                string ico = Path.Combine(Launcher.ProjectDir, "icons", "icon.ico");
                if (File.Exists(ico))
                {
                    trayIcon = new System.Drawing.Icon(ico);
                }
            }
            catch
            {
                /* ignore */
            }

            tray = new NotifyIcon { Icon = trayIcon, Visible = true, Text = "Arxiv PDF Translate" };

            menu = new ContextMenuStrip();
            var miShow = new ToolStripMenuItem("显示主界面");
            miStart = new ToolStripMenuItem("启动服务");
            miStop = new ToolStripMenuItem("停止服务");
            miAuto = new ToolStripMenuItem("开机自启") { CheckOnClick = true, Checked = Launcher.IsAutostart() };
            var miShortcut = new ToolStripMenuItem("创建桌面快捷方式");
            var miExit = new ToolStripMenuItem("退出");

            menu.Items.Add(miShow);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miStart);
            menu.Items.Add(miStop);
            menu.Items.Add(miAuto);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miShortcut);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(miExit);
            tray.ContextMenuStrip = menu;

            tray.MouseClick += delegate(object s, MouseEventArgs ev)
            {
                if (ev.Button == MouseButtons.Left) { ShowWindow(); }
            };
            tray.DoubleClick += delegate { ShowWindow(); };

            miShow.Click += delegate { ShowWindow(); };
            miStart.Click += delegate { Launcher.StartServer(null); UpdateStatus(); };
            miStop.Click += delegate { Launcher.StopServer(); UpdateStatus(); };
            miAuto.Click += delegate
            {
                Launcher.SetAutostart(miAuto.Checked);
                AutoCheck.IsChecked = miAuto.Checked;
            };
            miShortcut.Click += delegate { Launcher.CreateShortcut(); };
            miExit.Click += delegate { ExitApp(); };
        }

        private void ShowWindow()
        {
            Show();
            WindowState = WindowState.Normal;
            Activate();
        }

        private void ExitApp()
        {
            exiting = true;
            if (timer != null) { timer.Stop(); }
            if (tray != null)
            {
                tray.Visible = false;
                tray.Dispose();
            }
            Launcher.StopServer();
            System.Windows.Application.Current.Shutdown();
        }

        private void UpdateStatus()
        {
            bool up = Launcher.IsServerUp();
            StatusIcon.Data = (Geometry)FindResource(up ? "IconLink" : "IconUnlink");
            StatusIcon.Stroke = up ? DotOn : DotOff;
            StatusText.Text = up ? "服务在线" : "服务未启动";
            PortText.Text = up ? ("端口 " + Launcher.Port) : "";

            if (tray != null)
            {
                tray.Text = up
                    ? ("Arxiv PDF Translate · 在线 (端口 " + Launcher.Port + ")")
                    : "Arxiv PDF Translate · 未启动";
            }
            if (miStart != null) { miStart.Enabled = !up; }
            if (miStop != null) { miStop.Enabled = up; }
            StartButton.IsEnabled = !up;
            StopButton.IsEnabled = up;
        }

        private void RefreshLog()
        {
            string text = Launcher.ReadLogTail(400);
            if (LogBox.Text != text)
            {
                LogBox.Text = text;
                LogBox.ScrollToEnd();
            }
        }

        /* ---- block tab ---------------------------------------------------- */

        private static object[] AsArray(object value)
        {
            if (value == null) { return null; }
            object[] array = value as object[];
            if (array != null) { return array; }
            ArrayList list = value as ArrayList;
            return list != null ? list.ToArray() : null;
        }

        private static string S(Dictionary<string, object> dict, string key)
        {
            object value;
            return dict != null && dict.TryGetValue(key, out value) && value != null
                ? Convert.ToString(value) : "";
        }

        private static int N(Dictionary<string, object> dict, string key)
        {
            object value;
            int result;
            return dict != null && dict.TryGetValue(key, out value) && value != null
                && int.TryParse(Convert.ToString(value), out result) ? result : 0;
        }

        private void RefreshJobs()
        {
            string body = Launcher.HttpGet(Launcher.BaseUrl() + "/jobs", 2500);
            if (body == null)
            {
                JobsInfo.Text = "无法连接服务";
                return;
            }
            Dictionary<string, object> root;
            try { root = serializer.DeserializeObject(body) as Dictionary<string, object>; }
            catch { return; }
            object[] array = AsArray(root != null && root.ContainsKey("jobs") ? root["jobs"] : null);
            if (array == null) { return; }

            var items = new List<JobItem>();
            var signature = new StringBuilder();
            foreach (object entry in array)
            {
                var job = entry as Dictionary<string, object>;
                if (job == null) { continue; }
                items.Add(new JobItem
                {
                    Id = S(job, "id"),
                    Display = S(job, "filename") + "  [" + S(job, "status") + "]",
                });
                signature.Append(S(job, "id")).Append('|').Append(S(job, "status"))
                         .Append('|').Append(S(job, "block_index")).Append(';');
            }

            if (signature.ToString() != lastJobsSig)
            {
                lastJobsSig = signature.ToString();
                string current = JobCombo.SelectedItem is JobItem
                    ? ((JobItem)JobCombo.SelectedItem).Id : "";
                JobCombo.ItemsSource = items;
                int selected = 0;
                for (int i = 0; i < items.Count; i++)
                {
                    if (items[i].Id == current) { selected = i; break; }
                }
                if (items.Count > 0) { JobCombo.SelectedIndex = selected; }
            }

            JobsInfo.Text = items.Count + " 个任务";
            LoadBlocksForSelected();
        }

        private void LoadBlocksForSelected()
        {
            var item = JobCombo.SelectedItem as JobItem;
            if (item == null || string.IsNullOrEmpty(item.Id)) { return; }
            string jobId = item.Id;

            string body = Launcher.HttpGet(Launcher.BaseUrl() + "/jobs/" + jobId + "/blocks", 3000);
            if (body == null) { return; }
            object[] array;
            try
            {
                var root = serializer.DeserializeObject(body) as Dictionary<string, object>;
                array = AsArray(root != null && root.ContainsKey("blocks") ? root["blocks"] : null);
            }
            catch { return; }

            int count = array == null ? 0 : array.Length;
            if (jobId == lastBlockJobId && count == lastBlockCount) { return; }
            lastBlockJobId = jobId;
            lastBlockCount = count;

            var rows = new List<BlockRow>();
            if (array != null)
            {
                foreach (object entry in array)
                {
                    var block = entry as Dictionary<string, object>;
                    if (block == null) { continue; }
                    rows.Add(new BlockRow
                    {
                        Page = N(block, "page"),
                        Index = N(block, "index") + 1,
                        Src = S(block, "src"),
                        Dst = S(block, "dst"),
                    });
                }
            }
            BlockGrid.ItemsSource = rows;
        }

        private void RefreshJobsButton_Click(object sender, RoutedEventArgs e)
        {
            lastJobsSig = "";
            lastBlockJobId = "";
            lastBlockCount = -1;
            RefreshJobs();
        }

        /* ---- settings form ------------------------------------------------- */

        private void PopulateLangs()
        {
            SourceCombo.Items.Clear();
            TargetCombo.Items.Clear();
            for (int i = 0; i < LangCodes.Length; i++)
            {
                var src = new ComboBoxItem { Content = LangNames[i], Tag = LangCodes[i] };
                SourceCombo.Items.Add(src);
                if (LangCodes[i] != "auto")
                {
                    var tgt = new ComboBoxItem { Content = LangNames[i], Tag = LangCodes[i] };
                    TargetCombo.Items.Add(tgt);
                }
            }

            VariantCombo.Items.Clear();
            VariantCombo.Items.Add(new ComboBoxItem { Content = "双语 PDF（原文 + 译文）", Tag = "dual" });
            VariantCombo.Items.Add(new ComboBoxItem { Content = "仅译文 PDF", Tag = "mono" });
        }

        private static void SelectByTag(ComboBox combo, string tag)
        {
            for (int i = 0; i < combo.Items.Count; i++)
            {
                var item = combo.Items[i] as ComboBoxItem;
                if (item != null && Convert.ToString(item.Tag) == tag)
                {
                    combo.SelectedIndex = i;
                    return;
                }
            }
            if (combo.Items.Count > 0) { combo.SelectedIndex = 0; }
        }

        private static string SelectedTag(ComboBox combo)
        {
            var item = combo.SelectedItem as ComboBoxItem;
            return item == null ? null : Convert.ToString(item.Tag);
        }

        private static string MaskKey(string value)
        {
            value = value ?? "";
            if (value.Length == 0) { return ""; }
            if (value.Length <= 12) { return "*****"; }
            return value.Substring(0, 8) + "*****" + value.Substring(value.Length - 4);
        }

        private void LoadConfigForm()
        {
            Dictionary<string, object> config = Launcher.ReadConfig();
            BaseUrlBox.Text = Launcher.GetStr(config, "openai_base_url", "https://api.deepseek.com");
            ModelBox.Text = Launcher.GetStr(config, "openai_model", "deepseek-flash");
            KeyBox.Text = "";

            string key = Launcher.GetStr(config, "openai_api_key", "");
            KeyHint.Text = key.Length > 0
                ? ("已设置 " + MaskKey(key) + "，留空保持不变")
                : "未设置密钥";

            SelectByTag(SourceCombo, Launcher.GetStr(config, "source_lang", "en"));
            SelectByTag(TargetCombo, Launcher.GetStr(config, "target_lang", "zh-CN"));
            SelectByTag(VariantCombo, Launcher.GetStr(config, "output_variant", "dual"));
            ThreadsBox.Text = Launcher.GetStr(config, "threads", "4");
            PortBox.Text = Launcher.GetStr(config, "port", Launcher.Port > 0 ? Launcher.Port.ToString() : "8760");
            SetConfigResult("", null);
        }

        private void SetConfigResult(string text, bool? ok)
        {
            ConfigResult.Text = text;
            ConfigResult.Foreground = ok == null ? MutedBrush : (ok.Value ? OkBrush : ErrBrush);
        }

        private void SaveConfigButton_Click(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> config = Launcher.ReadConfig();

            config["openai_base_url"] = (BaseUrlBox.Text ?? "").Trim();
            config["openai_model"] = (ModelBox.Text ?? "").Trim();

            string key = (KeyBox.Text ?? "").Trim();
            if (key.Length > 0)
            {
                config["openai_api_key"] = key;
            }

            string src = SelectedTag(SourceCombo);
            string tgt = SelectedTag(TargetCombo);
            string variant = SelectedTag(VariantCombo);
            if (src != null) { config["source_lang"] = src; }
            if (tgt != null) { config["target_lang"] = tgt; }
            if (variant != null) { config["output_variant"] = variant; }

            int threads;
            if (int.TryParse((ThreadsBox.Text ?? "").Trim(), out threads) && threads >= 1)
            {
                config["threads"] = threads;
            }
            int port;
            if (int.TryParse((PortBox.Text ?? "").Trim(), out port) && port > 0 && port < 65536)
            {
                config["port"] = port;
            }

            if (!Launcher.WriteConfig(config))
            {
                SetConfigResult("保存失败（无法写入 config.json）", false);
                return;
            }

            Launcher.RefreshPort();
            Launcher.StopServer();
            System.Threading.Thread.Sleep(400);
            Launcher.StartServer(null);
            UpdateStatus();
            KeyBox.Text = "";
            LoadConfigForm();
            SetConfigResult("已保存并重启服务", true);
        }

        private void ReloadConfigButton_Click(object sender, RoutedEventArgs e)
        {
            LoadConfigForm();
            SetConfigResult("已重新载入", true);
        }

        private void ClearKeyButton_Click(object sender, RoutedEventArgs e)
        {
            Dictionary<string, object> config = Launcher.ReadConfig();
            config["openai_api_key"] = "";
            if (Launcher.WriteConfig(config))
            {
                Launcher.RefreshPort();
                Launcher.StopServer();
                System.Threading.Thread.Sleep(400);
                Launcher.StartServer(null);
                UpdateStatus();
                LoadConfigForm();
                SetConfigResult("已清除密钥", true);
            }
            else
            {
                SetConfigResult("清除失败", false);
            }
        }

        private void TestConnButton_Click(object sender, RoutedEventArgs e)
        {
            int port;
            if (!int.TryParse((PortBox.Text ?? "").Trim(), out port) || port <= 0)
            {
                port = Launcher.Port;
            }
            string url = "http://127.0.0.1:" + port + "/health";
            try
            {
                var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(url);
                request.Timeout = 2000;
                using (var response = (System.Net.HttpWebResponse)request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream()))
                {
                    string body = reader.ReadToEnd();
                    bool engineOk = body.IndexOf("\"engine_available\": true", StringComparison.OrdinalIgnoreCase) >= 0
                                 || body.IndexOf("\"engine_available\":true", StringComparison.OrdinalIgnoreCase) >= 0;
                    SetConfigResult(engineOk ? "连接成功" : "服务在线，但未找到翻译引擎", engineOk);
                }
            }
            catch
            {
                SetConfigResult("无法连接，请确认服务已启动", false);
            }
        }

        /* ---- control tab handlers ----------------------------------------- */

        private void StartButton_Click(object sender, RoutedEventArgs e)
        {
            Launcher.StartServer(null);
            UpdateStatus();
        }

        private void StopButton_Click(object sender, RoutedEventArgs e)
        {
            Launcher.StopServer();
            UpdateStatus();
        }

        private void ShortcutButton_Click(object sender, RoutedEventArgs e)
        {
            Launcher.CreateShortcut();
        }

        private void AutoCheck_Click(object sender, RoutedEventArgs e)
        {
            bool enabled = AutoCheck.IsChecked == true;
            Launcher.SetAutostart(enabled);
            if (miAuto != null) { miAuto.Checked = enabled; }
        }

        private void ExitButton_Click(object sender, RoutedEventArgs e)
        {
            ExitApp();
        }

        protected override void OnClosing(CancelEventArgs e)
        {
            if (!exiting)
            {
                e.Cancel = true;
                Hide();
            }
            base.OnClosing(e);
        }
    }

    public class JobItem
    {
        public string Id { get; set; }
        public string Display { get; set; }
    }

    public class BlockRow
    {
        public int Page { get; set; }
        public int Index { get; set; }
        public string Src { get; set; }
        public string Dst { get; set; }
    }
}
