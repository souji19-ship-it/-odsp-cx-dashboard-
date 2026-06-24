@echo off
REM Combined Dashboard Scraper - Scheduled Task Runner

set LOG_DIR=C:\repos\msft-reporting\logs
set LOG_FILE=%LOG_DIR%\combined-scraper-%DATE:~-4,4%%DATE:~-10,2%%DATE:~-7,2%-%TIME:~0,2%%TIME:~3,2%.log
set LOG_FILE=%LOG_FILE: =0%

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo ======================================== >> "%LOG_FILE%"
echo Combined Dashboard Scraper >> "%LOG_FILE%"
echo Started: %DATE% %TIME% >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"

cd /d C:\repos\msft-reporting

node run-all-scrapers.js >> "%LOG_FILE%" 2>&1

echo Completed: %DATE% %TIME% >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

exit /b %ERRORLEVEL%
