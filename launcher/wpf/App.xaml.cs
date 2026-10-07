using System;
using System.Windows;

namespace ArxivPdfTranslateWpf
{
    public partial class App : Application
    {
        protected override void OnStartup(StartupEventArgs e)
        {
            // "ArxivPdfTranslateWpf.exe --server" starts the local service only, then exits.
            if (Launcher.HasArg(e.Args, "--server"))
            {
                Launcher.ResolvePaths();
                Launcher.StartServerDetached();
                Environment.Exit(0);
                return;
            }

            base.OnStartup(e);
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            new MainWindow().Show();
        }
    }
}
