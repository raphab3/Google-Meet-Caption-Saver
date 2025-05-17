# Google Meet Caption Saver

A Chrome extension that automatically captures and saves captions from Google Meet meetings.

![Google Meet Caption Saver Logo](images/icon128.png)

## Features

- **Automatic Caption Capture**: Automatically captures captions during Google Meet meetings
- **Easy Saving**: Save captions as text files with a single click
- **Meeting History**: View and download captions from your recent meetings
- **Automatic Mode**: Option to automatically enable captions when joining a meeting
- **Privacy-Focused**: All data is stored locally on your device

## How It Works

1. **Join a Google Meet**: The extension activates when you join a Google Meet meeting
2. **Enable Captions**: The extension can automatically enable captions or you can manually start capturing
3. **Capture Captions**: All spoken text is captured in real-time during the meeting
4. **Save Captions**: When the meeting ends or when you click "Stop and Save", captions are saved as a text file
5. **View History**: Access your meeting history to download captions from previous meetings

## Installation

1. Download the extension from the Chrome Web Store (link coming soon)
2. Click "Add to Chrome" to install the extension
3. The extension icon will appear in your browser toolbar

## Usage

### Basic Usage

1. Join a Google Meet meeting
2. Click the extension icon in your browser toolbar
3. Click "Start Capturing" to begin capturing captions
4. When finished, click "Stop and Save" to save the captions as a text file

### Automatic Mode

1. Click the extension icon in your browser toolbar
2. Enable "Automatic Mode" in the settings
3. The extension will automatically enable captions and start capturing when you join a meeting
4. Captions will be automatically saved when the meeting ends

### Meeting History

1. Click the extension icon in your browser toolbar
2. Click "View Meeting History"
3. Browse your recent meetings and download captions as needed

## Privacy

The Google Meet Caption Saver extension is designed with privacy in mind:

- All caption data is stored locally on your device
- No data is sent to external servers
- The extension only accesses Google Meet pages
- Caption data is only saved when you choose to save it

For more details, see our [Privacy Policy](privacy.html).

## Technical Details

The extension uses the following technologies:

- Chrome Extension Manifest V3
- JavaScript
- HTML/CSS
- Chrome Storage API for local data storage
- Chrome Downloads API for saving caption files

## Development

### Project Structure

```
google-meet-caption-saver/
├── manifest.json        # Extension configuration
├── background.js        # Background service worker
├── content.js           # Content script for Google Meet pages
├── popup.html           # Extension popup interface
├── popup.js             # Popup functionality
├── meetings.html        # Meeting history page
├── meetings.js          # Meeting history functionality
├── privacy.html         # Privacy policy
├── developer.html       # Developer information
└── images/              # Extension icons and images
```

### Building from Source

1. Clone the repository
2. Make any desired modifications
3. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the extension directory

## Contributing

Contributions are welcome! If you'd like to contribute to the project, please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Author

Developed by Rafael Batista

## Support

If you encounter any issues or have questions about the extension, please open an issue on the GitHub repository.

---

*Google Meet Caption Saver is not affiliated with Google LLC. Google Meet is a trademark of Google LLC.*
