 STIX Visualizer

This project is an interactive web-based visualizer for STIX 2.x data. It allows users to upload STIX bundles (in JSON format), view the relationships between STIX objects as a graph, and explore the details of each object. The visualization is built using vis.js for graph rendering and provides an enhanced user interface for better interaction and data exploration.

![image](https://github.com/user-attachments/assets/54d3b1a1-5242-41a2-aafc-7e9f7179191a)# 

## Features

*   **Interactive Graph Visualization**: Displays STIX objects and their relationships as a dynamic, zoomable, and pannable graph.
*   **Multiple Data Loading Options**:
    *   Load STIX data by uploading a JSON file.
    *   Paste STIX JSON content directly into a text area.
    *   Fetch STIX data from a remote URL.
    *   Automatically loads a default STIX bundle (`bundle_2025_05_12_01_27.json`) on startup.
*   **Detailed Object View**: Click on nodes or edges in the graph to see their full STIX data in a structured format.
*   **Linked Node Exploration**: Easily see incoming and outgoing relationships for a selected object.
*   **Legend**: Dynamically generated legend for STIX object types and their corresponding icons.
*   **Timeline View**: If objects have version information, a timeline slider allows filtering objects by version.
*   **List View**: Option to display a large number of nodes as a list instead of a graph for better performance.
*   **Data Tables**: View STIX objects categorized by type (Indicators, Threat Actors, Malware, Attack Patterns, Relationships, All Objects) in sortable and filterable tables.
*   **IOC Summary**: A dedicated view for Indicators of Compromise (IOCs) with filtering options.
*   **Node Search**: Search for nodes within the graph.
*   **Object Editing (Basic)**: Rudimentary support for editing STIX object properties directly in the UI.
*   **Data Export**: Export the currently loaded STIX data as a JSON file.
*   **Responsive UI**: The interface adapts to different screen sizes with adjustable panel layouts.
*   **Toast Notifications**: Provides user feedback for actions like loading data, saving changes, etc.

## How to Use

### Viewing on GitHub Pages

This visualizer is hosted on GitHub Pages and can be accessed directly at:
[https://ashishkhar.github.io/CTI-STIX2.1-OPSIN/](https://ashishkhar.github.io/CTI-STIX2.1-OPSIN/)

Upon loading, it will attempt to display the default `bundle_2025_05_12_01_27.json` file included in the repository.

### Running Locally

1.  Clone this repository or download the files.
2.  Ensure all files (`index.html`, `application.js`, `application.css`, `require.js`, `domReady.js`, and the `stix2viz` directory, along with any STIX JSON bundles like `bundle_2025_05_12_01_27.json`) are in the same directory.
3.  Open the `index.html` file in a modern web browser.

### Loading Your Own Data

Once the page is loaded, you have several options to load your own STIX data:

*   **Upload File**: Click the "Choose Files" button or drag and drop a STIX JSON file onto the upload area.
*   **Paste JSON**: Paste your STIX JSON content into the text area provided and click "Parse & Visualize".
*   **Fetch from URL**: Enter a URL pointing to a raw STIX JSON file and click "Fetch & Visualize".

## Development Notes

The application uses `require.js` for module loading. Key JavaScript files include:
*   `application.js`: Contains the main logic for the user interface, data handling, and visualization setup.
*   `stix2viz/stix2viz/stix2viz.js`: The core STIX visualization library.
*   `stix2viz/visjs/vis-network.min.js`: The vis.js graphing library.

## STIX Data Generation

The example STIX 2.1 bundle (`bundle_2025_05_12_01_27.json`) provided with this visualizer is generated from unstructured threat intelligence text (e.g., blog posts, reports) using Natural Language Processing (NLP) and Large Language Models (LLMs).

Here's a brief overview of how/what the script does:

1.  **Data Ingestion**: It can scrape text content from a given URL or read from a local `input.txt` file.
2.  **LLM-Powered STIX Object Creation**: It utilizes an LLM (specifically configurable to use models like OpenAI's GPT via OpenRouter) to analyze the input text and generate:
    *   STIX Domain Objects (SDOs) such as Threat Actors, Malware, Indicators, Attack Patterns, etc.
    *   STIX Cyber-observable Objects (SCOs) like IP addresses, domain names, file hashes, URLs, etc.
    *   STIX Relationship Objects (SROs) to link the SDOs and SCOs, describing how they relate to one another (e.g., a Threat Actor *uses* a particular Malware).
3.  **Validation and Correction**: The script includes steps to validate the generated STIX objects against the STIX 2.1 specification. If invalid objects are produced, it can re-prompt the LLM to correct them.
4.  **UUID Assignment**: Unique IDs are assigned to each STIX object.
5.  **Bundle Creation**: Finally, all generated SDOs, SCOs, and SROs are combined into a single STIX Bundle (a JSON file).
6.  **Output**: The resulting bundle is saved as a timestamped JSON file (e.g., `bundle_YYYY_MM_DD_HH_MM.json`).

This script provides a way to automate the initial creation of structured STIX intelligence from unstructured sources, which can then be further refined and analyzed using tools like this visualizer.

---

This tool is designed to help security analysts, threat intelligence professionals, and researchers to quickly understand and navigate complex STIX data. 
