# Fresh Install Fixture

This fixture stands in for an empty application that has not installed MC yet.
The framework manifest ships it as a fixture. The installer dry run is the safe
validation path for this baseline:

```bash
powershell -ExecutionPolicy Bypass -File ./install.ps1 -Target fixtures/install-empty-next-app -DryRun -SkipPrompt
```
