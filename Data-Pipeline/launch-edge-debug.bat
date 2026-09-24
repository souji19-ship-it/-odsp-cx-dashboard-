@echo off
echo Starting a DEDICATED Edge debug window (separate profile) on port 9222...
echo This does NOT interfere with your normal Edge - no need to close it.
echo.
echo FIRST RUN: sign in to the CoWork dashboard (and Nezha for SPARK) in THIS window.
echo Your sign-in is remembered in this profile for future scrapes.
echo Keep this window open while the scraper runs.
echo.

"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --user-data-dir="%LOCALAPPDATA%\MSFTReportingEdge"

echo.
echo Edge debug window closed.
pause
