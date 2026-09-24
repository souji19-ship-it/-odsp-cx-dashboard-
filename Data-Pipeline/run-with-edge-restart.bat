@echo off
REM Set email flag
set SEND_EMAIL=1

REM Run the dashboard scraper
call "%~dp0run-all-dashboards.bat"
