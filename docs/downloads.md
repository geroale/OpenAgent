# Downloads

The desktop app is distributed through GitHub Releases. The page below always targets the latest stable release and groups the uploaded Electron artifacts by platform.

<ReleaseDownloads />

## Build From Source

```bash
cd app
./setup.sh
./build.sh macos
./build.sh windows
./build.sh linux
```

## Release Workflow

- Electron packages are uploaded by the repository release workflow.
- The download cards above update automatically when a new stable GitHub release is published.
- If you do not see a binary for your platform yet, use the source build path or browse the full release history.
