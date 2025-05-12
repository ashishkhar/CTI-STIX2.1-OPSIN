"use strict";
/*
Stix2viz and visjs are packaged in a way that makes them work as Jupyter
notebook extensions.  Part of the extension installation process involves
copying them to a different location, where they're available via a special
"nbextensions" path.  This path is hard-coded into their "require" module
IDs.  Perhaps it's better to use abstract names, and add special config
in all cases to map the IDs to real paths, thus keeping the modules free
of usage-specific hard-codings.  But packaging in a way I know works in
Jupyter (an already complicated environment), and having only this config
here, seemed simpler.  At least, for now.  Maybe later someone can structure
these modules and apps in a better way.
*/
require.config({
    paths: {
      "nbextensions/stix2viz/vis-network": "stix2viz/visjs/vis-network"
    }
});

require(["domReady!", "stix2viz/stix2viz/stix2viz"], function (document, stix2viz) {


    // Init some stuff
    let view = null;
    let uploader = document.getElementById('uploader');
    let canvasContainer = document.getElementById('canvas-container');
    let canvas = document.getElementById('canvas');
    let timelineVersions = null;
    let cumulativeIdGroups = null;
    let nonCumulativeIdGroups = null;
    let stixData = null; // Store the full STIX data
    let currentNodeDataSet = null;
    let currentEdgeDataSet = null;
    let currentStixIdToObject = null;
    let currentSelectedNode = null;

    /**
     * Build a message and display an alert window, from an exception object.
     * This will follow the exception's causal chain and display all of the
     * causes in sequence, to produce a more informative message.
     */
    function alertException(exc, initialMessage=null)
    {
        let messages = [];

        if (initialMessage)
            messages.push(initialMessage);

        messages.push(exc.toString());

        while (exc instanceof Error && exc.cause)
        {
            exc = exc.cause;
            messages.push(exc.toString());
        }

        let message = messages.join("\n\n    Caused by:\n\n");

        alert(message);
    }


    /**
     * Handle clicks on the visjs graph view.
     *
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     */
    function graphViewClickHandler(event, edgeDataSet, stixIdToObject)
    {
        if (event.nodes.length > 0)
        {
            // A click on a node
            let stixObject = stixIdToObject.get(event.nodes[0]);
            if (stixObject)
                populateSelected(stixObject, edgeDataSet, stixIdToObject);
        }
        else if (event.edges.length > 0)
        {
            // A click on an edge
            let stixRel = stixIdToObject.get(event.edges[0]);
            if (stixRel)
                populateSelected(stixRel, edgeDataSet, stixIdToObject);
            else
                // Just make something up to show for embedded relationships
                populateSelected(
                    new Map([["", "(Embedded relationship)"]]),
                    edgeDataSet, stixIdToObject
                );
        }
        // else, just a click on the canvas
    }


    /**
     * Handle clicks on the list view.
     *
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     */
    function listViewClickHandler(event, edgeDataSet, stixIdToObject)
    {
        let clickedItem = event.target;

        if (clickedItem.tagName === "LI")
        {
            let stixId = clickedItem.id;
            let stixObject = stixIdToObject.get(stixId);

            view.selectNode(stixId);

            if (stixObject)
                populateSelected(stixObject, edgeDataSet, stixIdToObject);
            else
                // Just make something up to show for embedded relationships
                populateSelected(
                    new Map([["", "(Embedded relationship)"]]),
                    edgeDataSet, stixIdToObject
                );
        }
    }


    /* ******************************************************
     * Initializes the view, then renders it.
     * ******************************************************/
    function vizStixWrapper(content, customConfig) {

        if (customConfig)
            try
            {
                customConfig = JSON.parse(customConfig);
            }
            catch(err)
            {
                alertException(err, "Invalid configuration: must be JSON");
                return;
            }
        else
            customConfig = {};

        // Store the full STIX data
        try {
            stixData = JSON.parse(content);
        } catch (e) {
            // If it's already an object, use it directly
            if (typeof content === 'object') {
                stixData = content;
            }
        }

        // Hard-coded working icon directory setting for this application.
        customConfig.iconDir = "stix2viz/stix2viz/icons";

        toggleView();

        try
        {
            let [nodeDataSet, edgeDataSet, stixIdToObject]
                = stix2viz.makeGraphData(content, customConfig);

            // Store for later use
            currentNodeDataSet = nodeDataSet;
            currentEdgeDataSet = edgeDataSet;
            currentStixIdToObject = stixIdToObject;

            [
                timelineVersions, cumulativeIdGroups, nonCumulativeIdGroups
            ] = makeTimelineGroups(nodeDataSet);

            let wantsList = false;
            if (nodeDataSet.length > 200)
                wantsList = confirm(
                    "This graph contains " + nodeDataSet.length.toString()
                    + " nodes.  Do you wish to display it as a list?"
                );

            if (wantsList)
            {
                view = stix2viz.makeListView(
                    canvas, nodeDataSet, edgeDataSet, stixIdToObject,
                    customConfig
                );

                view.on(
                    "click",
                    e => listViewClickHandler(e, edgeDataSet, stixIdToObject)
                );
            }
            else
            {
                view = stix2viz.makeGraphView(
                    canvas, nodeDataSet, edgeDataSet, stixIdToObject,
                    customConfig
                );

                view.on(
                    "click",
                    e => graphViewClickHandler(e, edgeDataSet, stixIdToObject)
                );
            }

            setupTimelineSlider(timelineVersions);
            populateLegend(...view.legendData);
            
            // Initialize the enhanced UI features
            initEnhancedUI(nodeDataSet, edgeDataSet, stixIdToObject);
        }
        catch (err)
        {
            console.log(err);
            alertException(err);
        }
    }

    function makeTimelineGroups(nodeDataSet, edgeDataSet)
    {
        // Find all non-null distinct version timestamps, in sorted order
        let distinctVersions = nodeDataSet.distinct("version");
        let idxNull = distinctVersions.indexOf(null);
        if (idxNull > -1)
            distinctVersions.splice(idxNull, 1);

        distinctVersions.sort((d1, d2) => d1 - d2);

        // Group node IDs by version.  For the cumulative groups, the last
        // group gets all IDs and previous groups get progressively fewer.
        let cumulativeIdGroups = [];
        let nonCumulativeIdGroups = [];
        for (let _ of distinctVersions)
        {
            cumulativeIdGroups.push(new Set());
            nonCumulativeIdGroups.push(new Set());
        }

        nodeDataSet.forEach(function(item) {
            let firstGroup = 0;

            if (item.version !== null)
                firstGroup = distinctVersions.indexOf(item.version);

            for (let i=firstGroup; i < distinctVersions.length; i++)
                cumulativeIdGroups[i].add(item.id);

            nonCumulativeIdGroups[firstGroup].add(item.id);
        });

        //console.log(distinctVersions);

        return [distinctVersions, cumulativeIdGroups, nonCumulativeIdGroups];
    }

    function setTimelineSliderLabelFor(sliderValue)
    {
        let slider = document.getElementById("timeline");
        let sliderLabel = slider.labels.item(0);

        let selectedVersion = timelineVersions[sliderValue];

        let timestampString = new Date(selectedVersion).toISOString();
        sliderLabel.textContent = "Timeline: " + timestampString;
    }

    function setupTimelineSlider(timelineVersions)
    {
        let slider = document.getElementById("timeline");
        let checkbox = document.getElementById("timelineCheckbox");

        if (timelineVersions.length < 1)
            return;

        slider.min = 0;
        slider.max = timelineVersions.length - 1;
        slider.value = slider.max;
        slider.disabled = false;

        setTimelineSliderLabelFor(slider.value);

        checkbox.disabled = false;
    }

    function setVisibilityForTimeline()
    {
        let timelineSlider = document.getElementById("timeline");
        let timelineCheckbox = document.getElementById("timelineCheckbox");

        let sliderValue = timelineSlider.value;
        let cumulative = timelineCheckbox.checked;
        let idGroups = cumulative ? cumulativeIdGroups : nonCumulativeIdGroups;

        let selectedGroup = idGroups[sliderValue];

        setTimelineSliderLabelFor(sliderValue);
        view.setVisible(selectedGroup);
    }

    function sliderChangeHandler(event)
    {
        event.stopPropagation();

        // Ignore the event and just read values from the webpage.  This makes
        // the handler agnostic to which event triggered the change.  You can
        // hook this handler to any event and it will do the same thing.
        setVisibilityForTimeline();
    }

    /* ----------------------------------------------------- *
     * ******************************************************
     * This group of functions is for handling file "upload."
     * They take an event as input and parse the file on the
     * front end.
     * ******************************************************/
    function handleFileSelect(evt) {
      handleFiles(evt.target.files);
    }
    function handleFileDrop(evt) {
      evt.stopPropagation();
      evt.preventDefault();

      handleFiles(evt.dataTransfer.files);
    }
    function handleDragOver(evt) {
      evt.stopPropagation();
      evt.preventDefault();
      evt.dataTransfer.dropEffect = 'copy'; // Explicitly show this is a copy.
    }
    function handleFiles(files) {
      // files is a FileList of File objects (in our case, just one)

      for (var i = 0, f; f = files[i]; i++) {
        document.getElementById('chosen-files').innerText += f.name + " ";
        let customConfig = document.getElementById('paste-area-custom-config').value;
        var r = new FileReader();
        r.onload = function(e) {vizStixWrapper(e.target.result, customConfig);};
        r.readAsText(f);
      }
      linkifyHeader();
    }
    /* ---------------------------------------------------- */

    /* ******************************************************
     * Handles content pasted to the text area.
     * ******************************************************/
    function handleTextarea() {
      let customConfig = document.getElementById('paste-area-custom-config').value;
      let content = document.getElementById('paste-area-stix-json').value;
      vizStixWrapper(content, customConfig);
      linkifyHeader();
    }

    /* ******************************************************
     * Fetches STIX 2.0 data from an external URL (supplied
     * user) via AJAX. Server-side Access-Control-Allow-Origin
     * must allow cross-domain requests for this to work.
     * ******************************************************/
    function handleFetchJson() {
      var url = document.getElementById("url").value;
      let customConfig = document.getElementById('paste-area-custom-config').value;
      fetchJsonAjax(url, function(content) {
        vizStixWrapper(content, customConfig);
      });
      linkifyHeader();
    }

    /**
     * Toggle the display of graph nodes of a particular STIX type.
     */
    function legendClickHandler(event)
    {
        if (!view)
            return;

        let td;
        let clickedTagName = event.target.tagName.toLowerCase();

        if (clickedTagName === "td")
            // ... if the legend item text was clicked
            td = event.target;
        else if (clickedTagName === "img")
            // ... if the legend item icon was clicked
            td = event.target.parentElement;
        else
            return;

        // The STIX type the user clicked on
        let toggledStixType = td.textContent.trim().toLowerCase();

        view.toggleStixType(toggledStixType);

        // style change to remind users what they've hidden.
        td.classList.toggle("typeHidden");
    }

    /* ******************************************************
     * Adds icons and information to the legend.
     * ******************************************************/
    function populateLegend(iconURLMap, defaultIconURL) {
        let tbody, tr, td;
        let colIdx = 0;
        let table = document.getElementById('legend-content');

        // Reset table content if necessary.
        if (table.tBodies.length === 0)
            tbody = table.createTBody();
        else
            tbody = table.tBodies[0];

        tbody.replaceChildren();

        tr = tbody.insertRow();

        for (let [stixType, iconURL] of iconURLMap)
        {
            let img = document.createElement('img');

            img.onerror = function() {
                // set the node's icon to the default if this image could not
                // load
                this.src = defaultIconURL;
                // our default svg is enormous... shrink it down!
                this.width = "37";
                this.height = "37";
            }
            img.src = iconURL;

            if (colIdx > 1)
            {
                colIdx = 0;
                tr = tbody.insertRow();
            }

            td = tr.insertCell();
            ++colIdx;

            td.append(img);
            td.append(stixType.charAt(0).toUpperCase() + stixType.substr(1).toLowerCase());
        }
    }

    /**
     * A JSON.stringify() replacer function to enable it to handle Map objects
     * like plain javascript objects.
     */
    function mapReplacer(key, value)
    {
        if (value instanceof Map)
        {
            let plainObj = {};
            for (let [subKey, subValue] of value)
                plainObj[subKey] = subValue;

            value = plainObj;
        }

        return value;
    }

    /**
     * Create a rendering of an array as part of rendering an overall STIX
     * object.
     *
     * @param arrayContent The array to render
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     * @param isRefs Whether the array is the value of a _refs property, i.e.
     *      an array of STIX IDs.  Used to produce a distinctive rendering for
     *      references.
     * @return The rendering as an array of DOM elements
     */
    function stixArrayContentToDOMNodes(
        arrayContent, edgeDataSet, stixIdToObject, isRefs=false
    )
    {
        let nodes = [];

        let ol = document.createElement("ol");
        ol.className = "selected-object-list";

        for (let elt of arrayContent)
        {
            let contentNodes;
            if (isRefs)
                contentNodes = stixStringContentToDOMNodes(
                    elt, edgeDataSet, stixIdToObject, /*isRef=*/true
                );
            else
                contentNodes = stixContentToDOMNodes(
                    elt, edgeDataSet, stixIdToObject
                );

            let li = document.createElement("li");
            li.append(...contentNodes);
            ol.append(li);
        }

        nodes.push(document.createTextNode("["));
        nodes.push(ol);
        nodes.push(document.createTextNode("]"));

        return nodes;
    }

    /**
     * Create a rendering of an object/dictionary as part of rendering an
     * overall STIX object.
     *
     * @param objectContent The object/dictionary to render, as a Map instance
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     * @param topLevel Whether objectContent is itself a whole STIX object,
     *      i.e. the top level of a content tree.  This is used to adjust the
     *      rendering, e.g. omit the surrounding braces at the top level.
     * @return The rendering as an array of DOM elements
     */
    function stixObjectContentToDOMNodes(
        objectContent, edgeDataSet, stixIdToObject, topLevel=false
    )
    {
        let nodes = [];

        if (!topLevel)
            nodes.push(document.createTextNode("{"));

        for (let [propName, propValue] of objectContent)
        {
            let propNameSpan = document.createElement("span");
            propNameSpan.className = "selected-object-prop-name";
            propNameSpan.append(propName + ":");

            let contentNodes;
            if (propName.endsWith("_ref"))
                 contentNodes = stixStringContentToDOMNodes(
                    propValue, edgeDataSet, stixIdToObject, /*isRef=*/true
                 );
            else if (propName.endsWith("_refs"))
                contentNodes = stixArrayContentToDOMNodes(
                    propValue, edgeDataSet, stixIdToObject, /*isRefs=*/true
                );
            else
                contentNodes = stixContentToDOMNodes(
                    propValue, edgeDataSet, stixIdToObject
                );

            let propDiv = document.createElement("div");
            propDiv.append(propNameSpan);
            propDiv.append(...contentNodes);

            if (!topLevel)
                propDiv.className = "selected-object-object-content";

            nodes.push(propDiv);
        }

        if (!topLevel)
            nodes.push(document.createTextNode("}"));

        return nodes;
    }

    /**
     * Create a rendering of a string value as part of rendering an overall
     * STIX object.
     *
     * @param stringContent The string to render
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     * @param isRef Whether the string is the value of a _ref property.  Used
     *      to produce a distinctive rendering for references.
     * @return The rendering as an array of DOM elements
     */
    function stixStringContentToDOMNodes(
        stringContent, edgeDataSet, stixIdToObject, isRef=false
    )
    {
        let nodes = [];

        let spanWrapper = document.createElement("span");
        spanWrapper.append(stringContent);

        if (isRef)
        {
            let referentObj = stixIdToObject.get(stringContent);
            if (referentObj)
            {
                spanWrapper.className = "selected-object-text-value-ref";
                spanWrapper.addEventListener(
                    "click", e => {
                        e.stopPropagation();
                        view.selectNode(referentObj.get("id"));
                        populateSelected(
                            referentObj, edgeDataSet, stixIdToObject
                        );
                    }
                );
            }
            else
                spanWrapper.className = "selected-object-text-value-ref-dangling";
        }
        else
            spanWrapper.className = "selected-object-text-value";

        nodes.push(spanWrapper);

        return nodes;
    }

    /**
     * Create a rendering of a value for which no other special rendering
     * applies, as part of rendering an overall STIX object.
     *
     * @param otherContent The content to render
     * @return The rendering as an array of DOM elements
     */
    function stixOtherContentToDOMNodes(otherContent)
    {
        let nodes = [];

        let asText;
        if (otherContent === null)
            asText = "null";
        else if (otherContent === undefined)
            asText = "undefined";  // also just in case??
        else
            asText = otherContent.toString();

        let spanWrapper = document.createElement("span");
        spanWrapper.append(asText);
        spanWrapper.className = "selected-object-nontext-value";
        nodes.push(spanWrapper);

        return nodes;
    }

    /**
     * Create a rendering of a value, as part of rendering an overall STIX
     * object.  This function dispatches to one of the more specialized
     * rendering functions based on the type of the value.
     *
     * @param stixContent The content to render
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     * @return The rendering as an array of DOM elements
     */
    function stixContentToDOMNodes(stixContent, edgeDataSet, stixIdToObject)
    {
        let nodes;

        if (stixContent instanceof Map)
            nodes = stixObjectContentToDOMNodes(
                stixContent, edgeDataSet, stixIdToObject
            );
        else if (Array.isArray(stixContent))
            nodes = stixArrayContentToDOMNodes(
                stixContent, edgeDataSet, stixIdToObject
            );
        else if (
            typeof stixContent === "string" || stixContent instanceof String
        )
            nodes = stixStringContentToDOMNodes(
                stixContent, edgeDataSet, stixIdToObject
            );
        else
            nodes = stixOtherContentToDOMNodes(stixContent);

        return nodes;
    }

    /**
     * Populate the Linked Nodes box with the connections of the given STIX
     * object.
     *
     * @param stixObject The STIX object to display connection information
     *      about
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     */
    function populateConnections(stixObject, edgeDataSet, stixIdToObject)
    {
        let objId = stixObject.get("id");

        let edges = edgeDataSet.get({
            filter: item => (item.from === objId || item.to === objId)
        });

        let eltConnIncoming = document.getElementById("connections-incoming");
        let eltConnOutgoing = document.getElementById("connections-outgoing");

        eltConnIncoming.replaceChildren();
        eltConnOutgoing.replaceChildren();

        let listIn = document.createElement("ol");
        let listOut = document.createElement("ol");

        eltConnIncoming.append(listIn);
        eltConnOutgoing.append(listOut);

        for (let edge of edges)
        {
            let targetList;
            let summaryNode = document.createElement("summary");
            let otherEndSpan = document.createElement("span");
            let otherEndObj;

            if (objId === edge.from)
            {
                otherEndObj = stixIdToObject.get(edge.to);
                otherEndSpan.append(otherEndObj.get("type"));

                summaryNode.append(edge.label + " ");
                summaryNode.append(otherEndSpan);

                targetList = listOut;
            }
            else
            {
                otherEndObj = stixIdToObject.get(edge.from);
                otherEndSpan.append(otherEndObj.get("type"));

                summaryNode.append(otherEndSpan);
                summaryNode.append(" " + edge.label);

                targetList = listIn;
            }

            otherEndSpan.className = "selected-object-text-value-ref";
            otherEndSpan.addEventListener(
                "click", e => {
                    view.selectNode(otherEndObj.get("id"));
                    populateSelected(otherEndObj, edgeDataSet, stixIdToObject);
                }
            );

            let li = document.createElement("li");
            let detailsNode = document.createElement("details");

            targetList.append(li);
            li.append(detailsNode);
            detailsNode.append(summaryNode);

            let objRenderNodes = stixObjectContentToDOMNodes(
                otherEndObj, edgeDataSet, stixIdToObject, /*topLevel=*/true
            );
            detailsNode.append(...objRenderNodes);
        }
    }

    /**
     * Populate relevant webpage areas according to a particular STIX object.
     *
     * @param stixObject The STIX object to display information about
     * @param edgeDataSet A visjs DataSet instance with graph edge data derived
     *      from STIX content
     * @param stixIdToObject A Map instance mapping STIX IDs to STIX objects as
     *      Maps, containing STIX content.
     */
    function populateSelected(stixObject, edgeDataSet, stixIdToObject) {
        // Remove old values from HTML
        let selectedContainer = document.getElementById('selection');
        selectedContainer.replaceChildren();

        let contentNodes = stixObjectContentToDOMNodes(
            stixObject, edgeDataSet, stixIdToObject, /*topLevel=*/true
        );
        selectedContainer.append(...contentNodes);

        populateConnections(stixObject, edgeDataSet, stixIdToObject);
    }

    /* ******************************************************
     * Toggle the view between the data entry container and
     * the view container
     * ******************************************************/
    function toggleView() {
      uploader.classList.toggle("hidden");
      canvasContainer.classList.toggle("hidden");
    }

    /* ******************************************************
     * Turns header into a "home" "link"
     * ******************************************************/
    function linkifyHeader() {
      var header = document.getElementById('header');
      header.classList.add('linkish');
    }

     /* *****************************************************
      * Returns the page to its original load state
      * *****************************************************/
    function resetPage() {
      var header = document.getElementById('header');
      if (header.classList.contains('linkish')) {
        toggleView();
        if (view)
        {
            view.destroy();
            view = null;
        }
        document.getElementById('files').value = ""; // reset the files input
        document.getElementById('chosen-files').innerHTML = ""; // reset the subheader text
        document.getElementById('selection').innerHTML = ""; // reset the selected node in the sidebar

        // Reset legend table
        let table = document.getElementById('legend-content');
        if (table.tBodies.length > 0)
        {
            let tbody = table.tBodies[0];
            tbody.replaceChildren();
        }

        // reset connections box
        let eltConnIncoming = document.getElementById("connections-incoming");
        let eltConnOutgoing = document.getElementById("connections-outgoing");
        eltConnIncoming.replaceChildren();
        eltConnOutgoing.replaceChildren();

        // disable timeline
        let timeline = document.getElementById("timeline");
        let timelineCheckbox = document.getElementById("timelineCheckbox");
        timeline.disabled = true;
        timelineCheckbox.disabled = true;

        timelineVersions = cumulativeIdGroups = nonCumulativeIdGroups = null;

        header.classList.remove('linkish');
      }
    }

    /* ******************************************************
     * Generic AJAX 'GET' request.
     *
     * Takes a URL and a callback function as input.
     * ******************************************************/
    function fetchJsonAjax(url, cfunc) {
      var regex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/i;
      if (!regex.test(url)) {
        alert("ERROR: Double check url provided");
      }

      var xhttp;
      if (window.XMLHttpRequest) {
        xhttp = new XMLHttpRequest();
      } else {
        xhttp = new ActiveXObject("Microsoft.XMLHTTP"); // For IE5 and IE6 luddites
      }
      xhttp.onreadystatechange = function() {
        if (xhttp.readyState == 4 && xhttp.status == 200) {
          cfunc(xhttp.responseText);
        } else if (xhttp.status != 200 && xhttp.status != 0) {
          alert("ERROR: " + xhttp.status + ": " + xhttp.statusText + " - Double check url provided");
          return;
        }

        xhttp.onerror = function() {
          alert("ERROR: Unable to fetch JSON. The domain entered has either rejected the request, \
is not serving JSON, or is not running a webserver.\n\nA GitHub Gist can be created to host RAW JSON data to prevent this.");
        };
      }
      xhttp.open("GET", url, true);
      xhttp.send();
    }

    /* ******************************************************
     * AJAX 'GET' request from `?url=` parameter
     *
     * Will check the URL during `window.onload` to determine
     * if `?url=` parameter is provided
     * ******************************************************/
    function fetchJsonFromUrl() {
      var url = window.location.href;

      // If `?` is not provided, load page normally
      if (/\?/.test(url)) {
        // Regex to see if `url` parameter has a valid url value
        var regex = /\?url=https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)/i;
        var res = regex.exec(url);
        if (res != null) {
          // Get the value from the `url` parameter
          let req_url = res[0].substring(5);

          // Fetch JSON from the url
          fetchJsonAjax(req_url, function(content) {
            vizStixWrapper(content)
          });
          linkifyHeader();

        } 
        
      }
    }

    function selectedNodeClick() {
      let selected = document.getElementById('selected');
      if (selected.className.indexOf('clicked') === -1) {
        selected.className += " clicked";
        selected.style.position = 'absolute';
        selected.style.left = '25px';
        selected.style.width = (window.innerWidth - 110) + "px";
        selected.style.top = (document.getElementById('canvas').offsetHeight + 25) + "px";
        selected.scrollIntoView(true);
      } else {
        selected.className = "sidebar"
        selected.removeAttribute("style")
      }
    }

    /* ******************************************************
     * When the page is ready, setup the visualization and bind events
     * ******************************************************/
    document.getElementById('files').addEventListener('change', handleFileSelect, false);
    document.getElementById('paste-parser').addEventListener('click', handleTextarea, false);
    document.getElementById('fetch-url').addEventListener('click', handleFetchJson, false);
    document.getElementById('header').addEventListener('click', resetPage, false);
    uploader.addEventListener('dragover', handleDragOver, false);
    uploader.addEventListener('drop', handleFileDrop, false);
    document.getElementById('selected').addEventListener('click', selectedNodeClick, false);
    document.getElementById("legend").addEventListener("click", legendClickHandler, {capture: true});
    document.getElementById("timeline").addEventListener("input", sliderChangeHandler, false);
    document.getElementById("timelineCheckbox").addEventListener("change", sliderChangeHandler, false);

    fetchJsonFromUrl();

    // Add automatic loading of the specified JSON file
    // This will run during initialization
    fetch('/bundle_2025_05_12_01_27.json')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("JSON loaded automatically");
            document.getElementById("uploader").style.display = "none";
            document.getElementById("canvas-container").classList.remove("hidden");
            document.getElementById("bottom-panel").classList.add("expanded"); // Ensure bottom panel is shown
            vizStixWrapper(data, null);
        })
        .catch(error => {
            console.error('Error loading JSON:', error);
            // If there's an error, don't hide the uploader
            if (showToast) {
                showToast('error', 'Error Loading Data', error.message);
            } else {
                alert('Error loading JSON file. You can upload your own STIX data instead.');
            }
        });

    // Add event listeners
    document.addEventListener('DOMContentLoaded', function() {
        // Handler for file select
        document.getElementById('files').addEventListener('change', handleFileSelect, false);
        document.getElementById('paste-parser').addEventListener('click', handleTextarea, false);
        document.getElementById('fetch-url').addEventListener('click', handleFetchJson, false);
        // Setup the drag and drop listeners
        let dropZone = document.getElementById('uploader');
        dropZone.addEventListener('dragover', handleDragOver, false);
        dropZone.addEventListener('drop', handleFileDrop, false);
        document.getElementById('legend').addEventListener('click', legendClickHandler, false);
        document.getElementById('selected').addEventListener('click', selectedNodeClick, false);
        document.getElementById('timeline').addEventListener('change', sliderChangeHandler, false);
        document.getElementById('timelineCheckbox').addEventListener('change', setVisibilityForTimeline, false);
        linkifyHeader();
    });

    /**
     * Initialize the enhanced UI features
     */
    function initEnhancedUI(nodeDataSet, edgeDataSet, stixIdToObject) {
        // Initialize bottom panel tabs
        initTabSystem();
        
        // Populate data tables
        populateDataTables(stixData);
        
        // Setup toolbar buttons
        initToolbarButtons(nodeDataSet, edgeDataSet, stixIdToObject);
        
        // Setup node search
        initNodeSearch(nodeDataSet);
        
        // Setup modals
        initModals();

        // Initialize upload zone
        initUploadZone();

        // Initialize IOC filtering
        initIOCFiltering();

        // Initialize toast notifications system
        initToastSystem();
        
        // Initialize tab control buttons
        initTabControls();
        
        // Activate the first tab by default
        const firstTab = document.querySelector('.tab');
        if (firstTab) {
            firstTab.click();
        }
        
        // Adjust the layout for the fixed split view
        adjustSplitViewLayout();
        
        // Add resize event listener to handle window resizing
        window.addEventListener('resize', adjustSplitViewLayout);
        
        // Show welcome toast
        showToast('success', 'Visualization Ready', 'STIX data loaded successfully. Click on nodes to explore.');
    }
    
    /**
     * Initialize the tab system in the bottom panel
     */
    function initTabSystem() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                // Remove active class from all tabs
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                tab.classList.add('active');
                
                // Hide all tab content
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                // Show the corresponding tab content
                const targetTab = tab.getAttribute('data-tab');
                document.getElementById(`${targetTab}-tab`).classList.add('active');
                
                // Make sure the tab content height is correct
                adjustTabContentHeight();
            });
        });
        
        // Initialize data view tabs if they exist
        document.querySelectorAll('.data-view-tab').forEach(dataTab => {
            dataTab.addEventListener('click', () => {
                const tabGroup = dataTab.closest('.data-view-tabs');
                if (!tabGroup) return;
                
                // Remove active class from all tabs in this group
                tabGroup.querySelectorAll('.data-view-tab').forEach(t => t.classList.remove('active'));
                // Add active class to clicked tab
                dataTab.classList.add('active');
                
                // Get the target data view
                const targetView = dataTab.getAttribute('data-view');
                if (!targetView) return;
                
                // Hide all content related to this tab group
                const tabContents = tabGroup.nextElementSibling;
                if (tabContents && tabContents.classList.contains('data-view-contents')) {
                    tabContents.querySelectorAll('.data-view-content').forEach(content => {
                        content.style.display = 'none';
                    });
                    
                    // Show the target content
                    const targetContent = tabContents.querySelector(`.data-view-content[data-view="${targetView}"]`);
                    if (targetContent) {
                        targetContent.style.display = 'block';
                    }
                }
            });
        });
    }
    
    /**
     * Adjust the layout for the fixed split view
     */
    function adjustSplitViewLayout() {
        const headerHeight = document.getElementById('top-header-bar').offsetHeight;
        const windowHeight = window.innerHeight;
        const canvasHeight = windowHeight * 0.4; // 40% of window height
        
        // Adjust the canvas container height
        const canvasContainer = document.getElementById('canvas-container');
        canvasContainer.style.height = `${canvasHeight}px`;
        canvasContainer.style.top = `${headerHeight}px`;
        
        // Adjust the bottom panel position and height
        const bottomPanel = document.getElementById('bottom-panel');
        bottomPanel.style.top = `${canvasHeight + headerHeight}px`;
        bottomPanel.style.height = `${windowHeight - canvasHeight - headerHeight}px`;
        
        // Adjust tab content height
        adjustTabContentHeight();
        
        // If we have a view, refresh it
        if (view && typeof view.redraw === 'function') {
            view.redraw();
        }
    }
    
    /**
     * Adjust the height of tab content based on the window size
     */
    function adjustTabContentHeight() {
        const headerHeight = document.getElementById('top-header-bar').offsetHeight;
        const windowHeight = window.innerHeight;
        const canvasHeight = windowHeight * 0.4; // 40% of window height
        const tabContainerHeight = document.querySelector('.tab-container').offsetHeight;
        
        // Set the height for the main data section to allow proper scrolling
        const mainDataSection = document.querySelector('.main-data-section');
        if (mainDataSection) {
            mainDataSection.style.maxHeight = `${windowHeight - canvasHeight - headerHeight}px`;
        }
        
        // Allow tab content to use available space
        document.querySelectorAll('.tab-content').forEach(content => {
            content.style.maxHeight = `${windowHeight - canvasHeight - headerHeight - tabContainerHeight}px`;
        });
        
        // Ensure details view has proper height
        const detailsView = document.getElementById('details-view');
        if (detailsView) {
            detailsView.style.maxHeight = `${windowHeight - canvasHeight - headerHeight - tabContainerHeight}px`;
        }
        
        // Set height for the details panels
        const detailsPanels = document.querySelector('.details-panels');
        if (detailsPanels) {
            detailsPanels.style.height = `${windowHeight - canvasHeight - headerHeight - tabContainerHeight}px`;
        }
    }
    
    /**
     * Initialize tab control buttons
     */
    function initTabControls() {
        // Toggle view mode button (data view / details view)
        const toggleViewModeBtn = document.getElementById('toggle-view-mode');
        if (toggleViewModeBtn) {
            let detailsViewActive = false;
            
            toggleViewModeBtn.addEventListener('click', () => {
                const dataView = document.getElementById('data-view');
                const detailsView = document.getElementById('details-view');
                
                if (detailsViewActive) {
                    // Switch to data view
                    dataView.classList.add('active');
                    detailsView.classList.remove('active');
                    toggleViewModeBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
                    toggleViewModeBtn.title = 'Switch to details view';
                    toggleViewModeBtn.classList.remove('active');
                    
                    showToast('info', 'Data View', 'Showing data tables view');
                } else {
                    // Switch to details view
                    dataView.classList.remove('active');
                    detailsView.classList.add('active');
                    toggleViewModeBtn.innerHTML = '<i class="fas fa-table"></i>';
                    toggleViewModeBtn.title = 'Switch to data view';
                    toggleViewModeBtn.classList.add('active');
                    
                    showToast('info', 'Details View', 'Showing details panels view');
                }
                
                detailsViewActive = !detailsViewActive;
                
                // Adjust layout
                adjustSplitViewLayout();
            });
        }
        
        // Toggle canvas size button
        const toggleCanvasSizeBtn = document.getElementById('toggle-canvas-size');
        if (toggleCanvasSizeBtn) {
            let canvasExpanded = false;
            
            toggleCanvasSizeBtn.addEventListener('click', () => {
                const canvasContainer = document.getElementById('canvas-container');
                const bottomPanel = document.getElementById('bottom-panel');
                const headerHeight = document.getElementById('top-header-bar').offsetHeight;
                const windowHeight = window.innerHeight;
                
                if (canvasExpanded) {
                    // Return to default 40/60 split
                    canvasContainer.style.height = `${windowHeight * 0.4}px`;
                    bottomPanel.style.top = `${windowHeight * 0.4 + headerHeight}px`;
                    bottomPanel.style.height = `${windowHeight - (windowHeight * 0.4) - headerHeight}px`;
                    toggleCanvasSizeBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
                    toggleCanvasSizeBtn.setAttribute('title', 'Expand canvas');
                } else {
                    // Expand canvas to 70%
                    canvasContainer.style.height = `${windowHeight * 0.7}px`;
                    bottomPanel.style.top = `${windowHeight * 0.7 + headerHeight}px`;
                    bottomPanel.style.height = `${windowHeight - (windowHeight * 0.7) - headerHeight}px`;
                    toggleCanvasSizeBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
                    toggleCanvasSizeBtn.setAttribute('title', 'Shrink canvas');
                }
                
                canvasExpanded = !canvasExpanded;
                
                // Adjust content heights
                adjustTabContentHeight();
                
                // Show notification
                showToast('info', canvasExpanded ? 'Canvas Expanded' : 'Canvas Default', 
                    canvasExpanded ? 'Graph view expanded to 70% of the screen' : 'Graph view returned to default size');
                
                // Redraw the graph if needed
                if (view && typeof view.redraw === 'function') {
                    view.redraw();
                }
            });
        }
    }
    
    /**
     * Show a selected node in the details panel
     */
    function viewObject(obj) {
        // Find the node in the graph
        if (view && obj.id) {
            view.selectNode(obj.id);
            
            // Convert the object to a Map for the existing code
            const objMap = new Map();
            Object.entries(obj).forEach(([key, value]) => {
                objMap.set(key, value);
            });
            
            populateSelected(objMap, currentEdgeDataSet, currentStixIdToObject);
            
            // Switch to details view if we're not already there
            const dataView = document.getElementById('data-view');
            const detailsView = document.getElementById('details-view');
            const toggleViewModeBtn = document.getElementById('toggle-view-mode');
            
            if (dataView.classList.contains('active')) {
                // Switch to details view
                dataView.classList.remove('active');
                detailsView.classList.add('active');
                
                if (toggleViewModeBtn) {
                    toggleViewModeBtn.innerHTML = '<i class="fas fa-table"></i>';
                    toggleViewModeBtn.title = 'Switch to data view';
                    toggleViewModeBtn.classList.add('active');
                }
            }
            
            // Scroll the selected panel into view in the bottom panel
            const selectedPanel = document.getElementById('selected');
            selectedPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    
    /**
     * Open the edit modal for a STIX object
     */
    function openEditModal(obj) {
        const modal = document.getElementById('edit-modal');
        const editor = document.getElementById('json-editor');
        
        // Set the editor content
        editor.value = JSON.stringify(obj, null, 2);
        
        // Show the modal
        modal.style.display = 'block';
        
        // Store the object ID for later use
        editor.setAttribute('data-id', obj.id);
    }
    
    /**
     * Initialize the toolbar buttons
     */
    function initToolbarButtons(nodeDataSet, edgeDataSet, stixIdToObject) {
        // Edit selected node button
        document.getElementById('edit-selected-btn').addEventListener('click', () => {
            if (currentSelectedNode) {
                const nodeEditor = document.getElementById('node-editor');
                const nodeEditContainer = document.getElementById('node-edit-container');
                
                // Convert Map to object for editing
                const nodeObj = {};
                currentSelectedNode.forEach((value, key) => {
                    nodeObj[key] = value;
                });
                
                // Format the JSON with proper indentation for better editing
                nodeEditor.value = JSON.stringify(nodeObj, null, 2);
                
                // Show the editor
                nodeEditContainer.style.display = 'block';
                
                // Make sure the sidebar content is visible
                const selectedPanel = document.getElementById('selected');
                const contentArea = selectedPanel.querySelector('.sidebar-content');
                if (contentArea) {
                    contentArea.style.display = 'block';
                }
                
                // Focus on the editor
                nodeEditor.focus();
                
                // Scroll to the selected panel
                selectedPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
                // Add syntax highlighting if possible
                try {
                    // Apply simple syntax highlighting if available
                    nodeEditor.style.color = 'var(--primary-color)';
                } catch (e) {
                    console.log('Simple syntax highlighting not applied');
                }
            } else {
                showToast('warning', 'No Node Selected', 'Please select a node to edit');
            }
        });
        
        // Show all data button
        document.getElementById('show-all-data-btn').addEventListener('click', () => {
            // Switch to data view if needed
            const dataView = document.getElementById('data-view');
            const detailsView = document.getElementById('details-view');
            const toggleViewModeBtn = document.getElementById('toggle-view-mode');
            
            if (!dataView.classList.contains('active')) {
                // Switch to data view
                dataView.classList.add('active');
                detailsView.classList.remove('active');
                
                if (toggleViewModeBtn) {
                    toggleViewModeBtn.innerHTML = '<i class="fas fa-info-circle"></i>';
                    toggleViewModeBtn.title = 'Switch to details view';
                    toggleViewModeBtn.classList.remove('active');
                }
            }
            
            // Activate the 'all' tab
            const allTab = document.querySelector('.tab[data-tab="all"]');
            if (allTab) {
                allTab.click();
            }
            
            // Scroll the main data section into view
            const mainDataSection = document.querySelector('.main-data-section');
            if (mainDataSection) {
                mainDataSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
            
            showToast('info', 'Data View', 'Showing all STIX objects');
        });
        
        // Export button
        document.getElementById('export-btn').addEventListener('click', () => {
            if (stixData) {
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(stixData, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "stix-export.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
                
                // Show success toast
                showToast('success', 'Export Complete', 'STIX data exported successfully');
            }
        });
        
        // Re-layout button
        document.getElementById('layout-btn').addEventListener('click', () => {
            if (view) {
                view.stabilize();
                showToast('info', 'Layout Refreshed', 'Graph layout has been recalculated');
            }
        });
        
        // Reset view button
        document.getElementById('reset-view-btn').addEventListener('click', () => {
            if (view) {
                view.resetView();
                showToast('info', 'View Reset', 'Graph view has been reset to default');
            }
        });
        
        // Save node button
        document.getElementById('save-node-btn').addEventListener('click', () => {
            saveNodeChanges();
        });
        
        // Cancel edit button
        document.getElementById('cancel-edit-btn').addEventListener('click', () => {
            document.getElementById('node-edit-container').style.display = 'none';
        });
        
        // Save edit button in modal
        document.getElementById('save-edit-btn').addEventListener('click', () => {
            saveModalChanges();
        });
        
        // Cancel modal button
        document.getElementById('cancel-modal-btn').addEventListener('click', () => {
            document.getElementById('edit-modal').style.display = 'none';
        });
    }
    
    /**
     * Save changes to a node from the sidebar editor
     */
    function saveNodeChanges() {
        try {
            const nodeEditor = document.getElementById('node-editor');
            const editedNode = JSON.parse(nodeEditor.value);
            
            if (!editedNode.id) {
                alert('Node must have an ID');
                return;
            }
            
            // Update the node in the visualization
            updateNodeInVisualization(editedNode);
            
            // Hide the editor
            document.getElementById('node-edit-container').style.display = 'none';
            
            // Update the STIX data
            updateStixData(editedNode);
            
            // Update the data tables
            populateDataTables(stixData);
        } catch (e) {
            alert('Error saving changes: ' + e.message);
        }
    }
    
    /**
     * Save changes from the edit modal
     */
    function saveModalChanges() {
        try {
            const editor = document.getElementById('json-editor');
            const editedObj = JSON.parse(editor.value);
            
            if (!editedObj.id) {
                alert('Object must have an ID');
                return;
            }
            
            // Update the node in the visualization if it exists
            updateNodeInVisualization(editedObj);
            
            // Update the STIX data
            updateStixData(editedObj);
            
            // Update the data tables
            populateDataTables(stixData);
            
            // Hide the modal
            document.getElementById('edit-modal').style.display = 'none';
        } catch (e) {
            alert('Error saving changes: ' + e.message);
        }
    }
    
    /**
     * Update a node in the visualization
     */
    function updateNodeInVisualization(objData) {
        if (!view || !currentNodeDataSet) return;
        
        // Check if the node exists in the visualization
        const nodeExists = currentNodeDataSet.get(objData.id);
        
        if (nodeExists) {
            // Update the node
            const updatedNode = {
                id: objData.id,
                title: objData.name || objData.value || extractPatternValue(objData.pattern) || objData.id,
                label: objData.name || objData.value || extractPatternValue(objData.pattern) || objData.id.split('--')[0]
            };
            
            currentNodeDataSet.update(updatedNode);
            
            // Update the Map in stixIdToObject
            if (currentStixIdToObject.has(objData.id)) {
                const objMap = new Map();
                Object.entries(objData).forEach(([key, value]) => {
                    objMap.set(key, value);
                });
                currentStixIdToObject.set(objData.id, objMap);
                
                // If this is the currently selected node, update the display
                if (currentSelectedNode && currentSelectedNode.get('id') === objData.id) {
                    populateSelected(objMap, currentEdgeDataSet, currentStixIdToObject);
                }
            }
        }
    }
    
    /**
     * Update the STIX data with edited object
     */
    function updateStixData(objData) {
        if (!stixData || !stixData.objects) return;
        
        // Find the object in the STIX data
        const index = stixData.objects.findIndex(obj => obj.id === objData.id);
        
        if (index !== -1) {
            // Update the object
            stixData.objects[index] = objData;
        } else {
            // Add the object
            stixData.objects.push(objData);
        }
    }
    
    /**
     * Initialize the node search functionality
     */
    function initNodeSearch(nodeDataSet) {
        const searchInput = document.getElementById('node-search');
        
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase();
            
            if (!view || !nodeDataSet) return;
            
            if (searchTerm.trim() === '') {
                // Reset highlighting
                nodeDataSet.forEach(node => {
                    node.color = undefined;
                    nodeDataSet.update(node);
                });
                return;
            }
            
            // Highlight matching nodes
            nodeDataSet.forEach(node => {
                const nodeLabel = node.label.toLowerCase();
                const nodeTitle = (node.title || '').toLowerCase();
                
                if (nodeLabel.includes(searchTerm) || nodeTitle.includes(searchTerm)) {
                    // Highlight the node
                    node.color = {
                        background: '#ffff00',
                        border: '#ffa500'
                    };
                } else {
                    // Reset the node color
                    node.color = undefined;
                }
                
                nodeDataSet.update(node);
            });
        });
    }
    
    /**
     * Initialize the modals
     */
    function initModals() {
        // Close buttons for modals
        document.querySelectorAll('.close-button').forEach(btn => {
            btn.addEventListener('click', () => {
                // Find the parent modal
                const modal = btn.closest('.modal');
                modal.style.display = 'none';
            });
        });
        
        // Close modal when clicking outside
        window.addEventListener('click', (event) => {
            if (event.target.classList.contains('modal')) {
                event.target.style.display = 'none';
            }
        });
    }
    
    /**
     * Initialize the upload zone with drag and drop
     */
    function initUploadZone() {
        const dropZone = document.getElementById('drop-zone');
        
        if (!dropZone) return;

        // Set up drag and drop events
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, unhighlight, false);
        });

        function highlight() {
            dropZone.classList.add('drag-over');
        }

        function unhighlight() {
            dropZone.classList.remove('drag-over');
        }

        // Handle drops
        dropZone.addEventListener('drop', handleFileDrop, false);

        // Make the drop zone click to upload
        dropZone.addEventListener('click', () => {
            document.getElementById('files').click();
        });
    }

    /**
     * Initialize IOC filtering functionality
     */
    function initIOCFiltering() {
        const filterButtons = document.querySelectorAll('.filter-btn');
        const searchInput = document.getElementById('ioc-search');
        
        if (!filterButtons.length || !searchInput) return;

        // Filter buttons
        filterButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Update active state
                filterButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Apply filter
                const filter = btn.getAttribute('data-filter');
                filterIOCTable(filter, searchInput.value);
            });
        });

        // Search input
        searchInput.addEventListener('input', () => {
            const activeFilter = document.querySelector('.filter-btn.active');
            const filter = activeFilter ? activeFilter.getAttribute('data-filter') : 'all';
            filterIOCTable(filter, searchInput.value);
        });
    }

    /**
     * Filter the IOC table based on type and search term
     */
    function filterIOCTable(typeFilter, searchTerm) {
        const rows = document.querySelectorAll('#ioc-summary-table tbody tr');
        
        rows.forEach(row => {
            const typeCol = row.querySelector('td:first-child').textContent.toLowerCase();
            const valueCol = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
            
            // Check if it matches the type filter
            const matchesType = typeFilter === 'all' || 
                                (typeFilter === 'ip' && (typeCol.includes('ipv4') || typeCol.includes('ipv6'))) ||
                                (typeFilter === 'domain' && typeCol.includes('domain')) ||
                                (typeFilter === 'url' && typeCol.includes('url')) ||
                                (typeFilter === 'hash' && typeCol.includes('hash'));
            
            // Check if it matches the search term
            const matchesSearch = !searchTerm || 
                                 valueCol.includes(searchTerm.toLowerCase()) ||
                                 typeCol.includes(searchTerm.toLowerCase());
            
            // Show/hide the row
            row.style.display = matchesType && matchesSearch ? '' : 'none';
        });
    }

    /**
     * Initialize toast notification system
     */
    function initToastSystem() {
        // Create container if it doesn't exist
        if (!document.getElementById('toast-container')) {
            const container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
    }

    /**
     * Show a toast notification
     * @param {string} type - success, error, warning, or info
     * @param {string} title - Title of the notification
     * @param {string} message - Message content
     * @param {number} duration - Duration in milliseconds
     */
    function showToast(type, title, message, duration = 4000) {
        const container = document.getElementById('toast-container');
        
        // Create toast element
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        // Set icon based on type
        let icon = 'info-circle';
        if (type === 'success') icon = 'check-circle';
        if (type === 'error') icon = 'times-circle';
        if (type === 'warning') icon = 'exclamation-triangle';
        
        // Create toast content
        toast.innerHTML = `
            <div class="toast-icon"><i class="fas fa-${icon}"></i></div>
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <div class="toast-close"><i class="fas fa-times"></i></div>
        `;
        
        // Add to container
        container.appendChild(toast);
        
        // Add close handler
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });
        
        // Auto remove after duration
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Override handleFiles to show success notification
     */
    const originalHandleFiles = handleFiles;
    handleFiles = function(files) {
        originalHandleFiles(files);
        
        // Display success notification
        if (files && files.length) {
            setTimeout(() => {
                showToast('success', 'File Loaded', `Successfully loaded ${files[0].name}`);
            }, 1000);
        }
    };

    /**
     * Override handleTextarea to show success notification
     */
    const originalHandleTextarea = handleTextarea;
    handleTextarea = function() {
        originalHandleTextarea();
        
        // Display success notification
        setTimeout(() => {
            showToast('success', 'Data Parsed', 'Successfully loaded pasted STIX data');
        }, 1000);
    };

    /**
     * Override handleFetchJson to show notifications
     */
    const originalHandleFetchJson = handleFetchJson;
    handleFetchJson = function() {
        const url = document.getElementById("url").value;
        
        // Show loading toast
        showToast('info', 'Fetching Data', `Loading STIX data from ${url}...`, 2000);
        
        // Call original function
        originalHandleFetchJson();
    };

    /**
     * Override the saveNodeChanges function to show success notification
     */
    const originalSaveNodeChanges = saveNodeChanges;
    saveNodeChanges = function() {
        try {
            originalSaveNodeChanges();
            
            // Show success notification
            showToast('success', 'Node Updated', 'Successfully saved node changes');
        } catch (e) {
            // Show error notification
            showToast('error', 'Error Saving Node', e.message);
            throw e;
        }
    };

    /**
     * Override the saveModalChanges function to show success notification
     */
    const originalSaveModalChanges = saveModalChanges;
    saveModalChanges = function() {
        try {
            originalSaveModalChanges();
            
            // Show success notification
            showToast('success', 'Object Updated', 'Successfully saved object changes');
        } catch (e) {
            // Show error notification
            showToast('error', 'Error Saving Object', e.message);
            throw e;
        }
    };

    /**
     * Update the visualization functions to be more user-friendly
     */
    const originalPopulateDataTables = populateDataTables;
    populateDataTables = function(stixData) {
        // Show loading spinner
        document.querySelectorAll('.data-table tbody').forEach(tbody => {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 2rem;">
                        <span class="spinner spinner-dark"></span> Loading data...
                    </td>
                </tr>
            `;
        });
        
        // Call original function with a slight delay to show the spinner
        setTimeout(() => {
            originalPopulateDataTables(stixData);
        }, 300);
    };

    /**
     * Extract pattern value from STIX pattern
     */
    function extractPatternValue(pattern) {
        if (!pattern) return '';
        
        // Handle common pattern types
        if (pattern.includes('ipv4-addr:value')) {
            const match = pattern.match(/ipv4-addr:value\s*=\s*'([^']+)'/);
            return match ? match[1] : pattern;
        } else if (pattern.includes('domain-name:value')) {
            const match = pattern.match(/domain-name:value\s*=\s*'([^']+)'/);
            return match ? match[1] : pattern;
        } else if (pattern.includes('url:value')) {
            const match = pattern.match(/url:value\s*=\s*'([^']+)'/);
            return match ? match[1] : pattern;
        } else if (pattern.includes('file:hashes.MD5')) {
            const match = pattern.match(/file:hashes\.[^:]+\s*=\s*'([^']+)'/);
            return match ? match[1] : pattern;
        } else {
            // Return a shortened version for other patterns
            return pattern.length > 50 ? pattern.substring(0, 47) + '...' : pattern;
        }
    }
    
    /**
     * Determine the pattern type from a STIX pattern
     */
    function determinePatternType(pattern) {
        if (!pattern) return 'Unknown';
        
        if (pattern.includes('ipv4-addr:value')) {
            return 'IPv4';
        } else if (pattern.includes('ipv6-addr:value')) {
            return 'IPv6';
        } else if (pattern.includes('domain-name:value')) {
            return 'Domain';
        } else if (pattern.includes('url:value')) {
            return 'URL';
        } else if (pattern.includes('file:hashes.MD5')) {
            return 'MD5 Hash';
        } else if (pattern.includes('file:hashes.SHA-1')) {
            return 'SHA-1 Hash';
        } else if (pattern.includes('file:hashes.SHA-256')) {
            return 'SHA-256 Hash';
        } else if (pattern.includes('email-addr:value')) {
            return 'Email';
        } else {
            return 'Other';
        }
    }
    
    /**
     * Get a display name for a STIX object
     */
    function getDisplayName(obj) {
        if (!obj) return 'Unknown';
        
        if (obj.name) {
            return obj.name;
        } else if (obj.value) {
            return obj.value;
        } else if (obj.pattern) {
            return extractPatternValue(obj.pattern);
        } else if (obj.relationship_type) {
            return obj.relationship_type;
        } else if (obj.id) {
            return obj.id.split('--')[0];
        } else {
            return 'Unnamed';
        }
    }
    
    /**
     * Format a date string for display
     */
    function formatDate(dateString) {
        if (!dateString) return '';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleString();
        } catch (e) {
            return dateString;
        }
    }
    
    /**
     * Populate the data tables with STIX objects
     */
    function populateDataTables(stixData) {
        if (!stixData || !stixData.objects) return;
        
        const objects = stixData.objects;
        
        // Clear existing table content
        document.getElementById('indicators-body').innerHTML = '';
        document.getElementById('threat-actors-body').innerHTML = '';
        document.getElementById('malware-body').innerHTML = '';
        document.getElementById('attack-patterns-body').innerHTML = '';
        document.getElementById('relationships-body').innerHTML = '';
        document.getElementById('all-objects-body').innerHTML = '';
        document.getElementById('ioc-summary-body').innerHTML = '';
        
        // Group objects by type
        const indicators = [];
        const threatActors = [];
        const malware = [];
        const attackPatterns = [];
        const relationships = [];
        
        objects.forEach(obj => {
            // Add to the all objects table
            const allRow = document.createElement('tr');
            allRow.innerHTML = `
                <td>${obj.type}</td>
                <td>${obj.id}</td>
                <td>${getDisplayName(obj)}</td>
                <td>${formatDate(obj.created)}</td>
                <td>${formatDate(obj.modified)}</td>
                <td>
                    <button class="view-btn" data-id="${obj.id}">View</button>
                    <button class="edit-btn" data-id="${obj.id}">Edit</button>
                </td>
            `;
            document.getElementById('all-objects-body').appendChild(allRow);
            
            // Add to specific type tables
            if (obj.type === 'indicator') {
                indicators.push(obj);
                
                const indicatorRow = document.createElement('tr');
                indicatorRow.innerHTML = `
                    <td>${obj.name || 'Unnamed'}</td>
                    <td>${determinePatternType(obj.pattern)}</td>
                    <td class="indicator-value">${extractPatternValue(obj.pattern)}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('indicators-body').appendChild(indicatorRow);
                
                // Also add to the IOC summary
                const iocRow = document.createElement('tr');
                iocRow.innerHTML = `
                    <td>${determinePatternType(obj.pattern)}</td>
                    <td class="indicator-value">${extractPatternValue(obj.pattern)}</td>
                    <td>${obj.pattern_type || 'stix'}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('ioc-summary-body').appendChild(iocRow);
            } else if (obj.type === 'threat-actor') {
                threatActors.push(obj);
                
                const actorRow = document.createElement('tr');
                actorRow.innerHTML = `
                    <td>${obj.name || 'Unnamed'}</td>
                    <td>${obj.description || ''}</td>
                    <td>${obj.identity_class || ''}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('threat-actors-body').appendChild(actorRow);
            } else if (obj.type === 'malware') {
                malware.push(obj);
                
                const malwareRow = document.createElement('tr');
                malwareRow.innerHTML = `
                    <td>${obj.name || 'Unnamed'}</td>
                    <td>${obj.description || ''}</td>
                    <td>${Array.isArray(obj.malware_types) ? obj.malware_types.join(', ') : ''}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('malware-body').appendChild(malwareRow);
            } else if (obj.type === 'attack-pattern') {
                attackPatterns.push(obj);
                
                let killChainPhases = '';
                if (obj.kill_chain_phases && Array.isArray(obj.kill_chain_phases)) {
                    killChainPhases = obj.kill_chain_phases.map(kc => `${kc.kill_chain_name}: ${kc.phase_name}`).join(', ');
                }
                
                const attackRow = document.createElement('tr');
                attackRow.innerHTML = `
                    <td>${obj.name || 'Unnamed'}</td>
                    <td>${obj.description || ''}</td>
                    <td>${killChainPhases}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('attack-patterns-body').appendChild(attackRow);
            } else if (obj.type === 'relationship') {
                relationships.push(obj);
                
                // Find source and target objects
                const sourceObj = objects.find(o => o.id === obj.source_ref);
                const targetObj = objects.find(o => o.id === obj.target_ref);
                
                const relRow = document.createElement('tr');
                relRow.innerHTML = `
                    <td>${sourceObj ? getDisplayName(sourceObj) : obj.source_ref}</td>
                    <td>${obj.relationship_type}</td>
                    <td>${targetObj ? getDisplayName(targetObj) : obj.target_ref}</td>
                    <td>${formatDate(obj.created)}</td>
                    <td>${formatDate(obj.modified)}</td>
                    <td>
                        <button class="view-btn" data-id="${obj.id}">View</button>
                        <button class="edit-btn" data-id="${obj.id}">Edit</button>
                    </td>
                `;
                document.getElementById('relationships-body').appendChild(relRow);
            }
        });
        
        // Add event listeners to the view and edit buttons
        document.querySelectorAll('.view-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const obj = objects.find(o => o.id === id);
                if (obj) {
                    viewObject(obj);
                }
            });
        });
        
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-id');
                const obj = objects.find(o => o.id === id);
                if (obj) {
                    openEditModal(obj);
                }
            });
        });
    }
    
    /**
     * Override the populateSelected function to store the current selected node
     */
    const originalPopulateSelected = populateSelected;
    populateSelected = function(stixObject, edgeDataSet, stixIdToObject) {
        // Store the current selected node
        currentSelectedNode = stixObject;
        
        // Call the original function
        originalPopulateSelected(stixObject, edgeDataSet, stixIdToObject);
    };
});
