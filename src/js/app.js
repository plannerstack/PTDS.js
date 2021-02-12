import * as log from 'loglevel';
import $ from 'jquery';
import 'simpler-sidebar';

import PTDS from './ptds';

// Enable logging at all levels
log.enableAll();

const options = {
  stopRadius: 1,
  stopAreaRadius: 1,
  tripRadius: 2,
  showStops: false,
  showStopAreas: true,
  showLinks: true,
  // mode can be either 'dual', 'spiralSimulation' or 'marey'
  // marey = fullscreen marey, dual = marey + linked map, spiralSimulation = spiral simulation
  mode: 'spiralSimulation',
  // spiralSimulation specific options
  spiral: {
    timeMultiplier: 30,
    paramA: 30,
    paramB: 0,
  },
  // dual specific options
  dual: {
    verticalSplitPercentage: (Math.sqrt(5) - 1) / 2,
  },
};

let indexData = {};

// Get the URL of the currently selected dataset
const getSelectedDatasetURL = () => {
  // Get the publication currently selected (date)
  const publicationInUse = indexData.publications
    .find(pub => pub.date === document.getElementById('day').value);
  // Get the dataset currently selected (group of lines) within the publication selected
  const datasetInUse = publicationInUse.datasets
    .find(dataset => dataset.filename === document.getElementById('lines-groups').value);
  // Compute URL of dataset selected
  return `${publicationInUse.url}${datasetInUse.filename}`;
};

const getSelectedDatasetMarkersURL = () => {
  // Get the publication currently selected (date)
  const publicationInUse = indexData.publications
    .find(pub => pub.date === document.getElementById('day').value);
  // Get the dataset currently selected (group of lines) within the publication selected
  // Compute URL of dataset selected
  return `${publicationInUse.url}markers.json`;
};

// Load the available line-directions within this group of lines
const loadAvailableLineDirections = () => {
  fetch(getSelectedDatasetURL())
    .then(r => r.json())
    .then((data) => {
      const lineDirection = document.getElementById('line-direction');
      // Remove the currently available line - direction pairs
      lineDirection.innerHTML = '';
      const lineDirectionPairs = {};
      // Add the new line - direction pairs
      for (const journeyPattern of Object.values(data.journeyPatterns)) {
        const { direction, lineRef } = journeyPattern;
        lineDirectionPairs[`${lineRef} - ${direction}`] = 1;
      }
      const orderedLDpairs = Array.from(Object.keys(lineDirectionPairs));
      orderedLDpairs.sort();
      for (const lineDirectionPair of orderedLDpairs) {
        lineDirection.innerHTML += `<option value="${lineDirectionPair}">${lineDirectionPair}</option>`;
      }
    });
};

// Process the index file populating the sidebar with the available parameters,
// as soon as it is loaded
const processIndex = () => {
  const publications = indexData.publications.sort((a, b) => b.date.localeCompare(a.date));

  const modeSelect = document.getElementById('mode');
  modeSelect.onchange = () => {
    const displayStyleLDselect = ['dual', 'marey'].includes(modeSelect.value) ? 'block' : 'none';
    document.getElementsByClassName('linedirectionSel')[0].style.display = displayStyleLDselect;
  };

  // Populate date picker with available options
  const daySelect = document.getElementById('day');
  for (const publication of publications) {
    daySelect.innerHTML += `<option value="${publication.date}">${publication.date}</option>`;
  }
  // When date is picked, populate the dropdown for the group of lines
  daySelect.onchange = () => {
    const linesGroupsSelect = document.getElementById('lines-groups');
    const dayDatasets = publications.find(pub => pub.date === daySelect.value).datasets;
    linesGroupsSelect.innerHTML = '';
    for (const dataset of dayDatasets) {
      const lines = dataset.lines.join(', ');
      linesGroupsSelect.innerHTML += `<option value="${dataset.filename}">${lines}</option>`;
    }
    loadAvailableLineDirections();
  };

  // Populate group of lines dropdown
  const linesGroupsSelect = document.getElementById('lines-groups');
  for (const dataset of publications[0].datasets) {
    const lines = dataset.lines.join(', ');
    linesGroupsSelect.innerHTML += `<option value="${dataset.filename}">${lines}</option>`;
  }
  // Update available journey patterns when group of line is picked
  linesGroupsSelect.onchange = loadAvailableLineDirections;

  // Load the available journey patterns and make that dropdown visible
  loadAvailableLineDirections();

  /* eslint no-new: "off" */
  // Fetch default dataset and create its corresponding visualization
  // const defaultDatasetURL = `${publications[0].url}${publications[0].datasets[0].filename}`;
  Object.assign(options, { selectedDate: publications[0].date });
  // fetch(defaultDatasetURL).then(r => r.json())
  //  .then((defaultData) => { new PTDS(defaultData, options, null); });
};

// URL Hash trip selection
const urlHashTripSelection = (url, tripCode, date) => {
  // Load the chosen dataset
  fetch(url).then(r => r.json())
    .then((data) => {
      // Empty the main div element
      document.getElementById('main').innerHTML = '';
      // Remove the dat.GUI widget(s) if present
      for (const dg of document.getElementsByClassName('dg main')) dg.remove();

      const journeyPattern = data.journeyPatterns[data.vehicleJourneys[tripCode].journeyPatternRef];

      // Create new visualization, using the specified mode.
      const selectedMode = 'marey';
      options.mode = selectedMode;
      options.line = journeyPattern.lineRef;
      options.direction = journeyPattern.direction;
      options.overlap = true;
      options.realtime = true;
      options.trip = tripCode;
      Object.assign(options, { selectedDate: date });
      new PTDS(data, options, null);
    });
};

// Form submission handler
const formSubmit = (event) => {
  // Prevent default form submit
  event.preventDefault();

  // Get URL of dataset selected
  const urlLinesGroupsSelected = getSelectedDatasetURL();

  // Load the chosen dataset
  fetch(urlLinesGroupsSelected).then(r => r.json())
    .then((data) => {
      // Empty the main div element
      document.getElementById('main').innerHTML = '';
      // Remove the dat.GUI widget(s) if present
      for (const dg of document.getElementsByClassName('dg main')) dg.remove();

      // Create new visualization, using the specified mode.
      const selectedMode = document.getElementById('mode').value;
      if (['dual', 'marey'].includes(selectedMode)) {
        options.mode = selectedMode;
        const [line, direction] = document.getElementById('line-direction').value.split(' - ');
        options.line = line;
        options.direction = parseInt(direction, 10);
        options.overlap = document.getElementById('line-direction-overlap').checked;
        options.realtime = document.getElementById('realtime').checked;
      } else {
        options.mode = 'spiralSimulation';
      }
      Object.assign(options, { selectedDate: document.getElementById('day').value });

      const urlMarkersSelected = getSelectedDatasetMarkersURL();
      fetch(urlMarkersSelected).then(r => r.json())
        .then((markerdata) => {
          new PTDS(data, options, markerdata);
        })
        .catch(() => {
          /* When developing remove this catch */
          new PTDS(data, options, null);
        });
    });
};

$(document).ready(() => {
  // As soon as the document is ready, fetch the index file
  const indexFileURL = 'https://services.opengeo.nl/ptds/index.json';
  fetch(indexFileURL).then(r => r.json())
    // Process the index file when finished loading it
    .then((data) => {
      indexData = data;
      processIndex();

      // Handle loading a trip from a URL
      const { hash } = window.location;
      if (hash !== '' && hash !== '#') {
        const tripCode = hash.substring(1, hash.length);
        const parts = tripCode.split(':');
        const lineCode = parts[1];
        const date = parts[3];
        document.getElementById('day').value = date;
        document.getElementById('mode').value = 'marey';

        const publication = indexData.publications.filter(e => (e.date === date));
        if (publication.length > 0) {
          const publicationInUse = publication[0];
          const dataset = publicationInUse.datasets.filter(e => (e.lines.includes(lineCode)));
          if (dataset.length > 0) {
            const datasetInUse = dataset[0];
            document.getElementById('lines-groups').value = datasetInUse.filename;
            const url = `${publicationInUse.url}${datasetInUse.filename}`;
            urlHashTripSelection(url, tripCode, date);
          }
        }
      }
    });

  const { hash } = window.location;

  // Activate sidebar plugin
  $('#sidebar').simplerSidebar({
    init: (hash === '' || hash === '#') ? 'opened' : 'closed',
    selectors: {
      trigger: '#toggle-sidebar',
      quitter: '.close-sidebar',
    },
  });
  // and make it visible again
  document.getElementById('sidebar').style.visibility = 'visible';
  document.getElementById('navbar').style.visibility = 'visible';

  // Handle new dataset/mode loading
  document.getElementById('viz-options').onsubmit = formSubmit;
});
