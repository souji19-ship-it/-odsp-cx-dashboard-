@echo off
echo Starting Edge with remote debugging...
echo.
echo You can now use this Edge window for scraping.
echo Keep this window open while running the scraper.
echo.

"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222

echo.
echo Edge has been closed.
pause
