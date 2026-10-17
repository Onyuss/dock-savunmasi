@echo off
cd /d "%~dp0"
echo Dock Savunmasi baslatiliyor... Bu pencereyi oyun boyunca acik tut.
start "" http://localhost:8080
python -m http.server 8080
