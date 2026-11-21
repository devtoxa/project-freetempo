# pip install yt-dlp
import sys
import os
from PyQt5.QtCore import QThread, pyqtSignal, QObject
from PyQt5.QtWidgets import QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QLineEdit, QPushButton, QProgressBar, QTextEdit

# 1. Create a custom hook to intercept yt-dlp log messages


class MyLogger(QObject):
    def __init__(self, signal):
        super().__init__()
        self.signal = signal

    def debug(self, msg):
        # yt-dlp outputs its primary progress status through debug
        if "download" in msg:
            self.signal.emit(msg)
        else:
            self.signal.emit(f"[DEBUG] {msg}")

    def warning(self, msg):
        self.signal.emit(f"[WARNING] {msg}")

    def error(self, msg):
        self.signal.emit(f"[ERROR] {msg}")


# 2. Worker Thread for Downloading
class DownloadWorker(QThread):
    # Signals to communicate back to the main GUI thread
    progress_signal = pyqtSignal(str)
    percent_signal = pyqtSignal(int)
    finished_signal = pyqtSignal(bool, str)

    def __init__(self, url):
        super().__init__()
        self.url = url

    def run(self):
        import yt_dlp

        # A progress hook specifically targeting the percentage metrics
        def progress_hook(d):
            if d['status'] == 'downloading':
                # Strip ANSI escape codes if present and extract numerical value
                total = d.get('total_bytes') or d.get(
                    'total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes', 0)
                if total > 0:
                    percent = int((downloaded / total) * 100)
                    self.percent_signal.emit(percent)
            elif d['status'] == 'finished':
                self.percent_signal.emit(100)

        # Options dictionary utilizing our logger and progress hook
        ydl_opts = {
            'format': 'best',
            'logger': MyLogger(self.progress_signal),
            'progress_hooks': [progress_hook],
            # Saves to user Downloads folder
            'outtmpl': os.path.join(os.path.expanduser('~'), 'Downloads', '%(title)s.%(ext)s')
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([self.url])
            self.finished_signal.emit(True, "Download Completed Successfully!")
        except Exception as e:
            self.finished_signal.emit(False, str(e))


# 3. Main GUI Application Window
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.init_ui()

    def init_ui(self):
        self.setWindowTitle("yt-dlp PyQt5 Downloader")
        self.resize(600, 400)

        # Layout & Widgets
        central_widget = QWidget()
        self.setCentralWidget(central_widget)
        layout = QVBoxLayout(central_widget)

        # Input Row
        input_layout = QHBoxLayout()
        self.url_input = QLineEdit()
        self.url_input.setPlaceholderText("Paste video URL here...")
        self.download_btn = QPushButton("Download")

        input_layout.addWidget(self.url_input)
        input_layout.addWidget(self.download_btn)
        layout.addLayout(input_layout)

        # Progress Bar
        self.progress_bar = QProgressBar()
        self.progress_bar.setValue(0)
        layout.addWidget(self.progress_bar)

        # Log Console
        self.log_console = QTextEdit()
        self.log_console.setReadOnly(True)
        layout.addWidget(self.log_console)

        # Events
        self.download_btn.clicked.connect(self.start_download)

    def start_download(self):
        url = self.url_input.text().strip()
        if not url:
            self.log_console.append("[System] Please enter a valid URL.")
            return

        self.download_btn.setEnabled(False)
        self.progress_bar.setValue(0)
        self.log_console.append(f"[System] Starting download for: {url}")

        # Initialize the background worker
        self.worker = DownloadWorker(url)

        # Connect worker signals to local UI update slots
        self.worker.progress_signal.connect(self.update_log)
        self.worker.percent_signal.connect(self.update_progress_bar)
        self.worker.finished_signal.connect(self.download_finished)

        # Launch the thread safely
        self.worker.start()

    def update_log(self, text):
        self.log_console.append(text)
        # Auto-scroll to the bottom of the log
        self.log_console.ensureCursorVisible()

    def update_progress_bar(self, value):
        self.progress_bar.setValue(value)

    def download_finished(self, success, message):
        self.download_btn.setEnabled(True)
        if success:
            self.log_console.append(f"\n[System Success] {message}")
        else:
            self.log_console.append(f"\n[System Error] {message}")

        # Clean up the worker memory safely
        self.worker.deleteLater()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec_())
