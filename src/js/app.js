import * as log from 'loglevel';
import $ from 'jquery';
import 'simpler-sidebar';

import PTDS from './ptds';

// Enable logging at all levels
log.enableAll();

const options = {
  stopRadius: 1,
  stopAreaRadius: 1,
  tripRadius: 3,
  showStops: false,
  showStopAreas: true,
  showLinks: true,
  // mode can be either 'dual' or 'spiralSimulation'
  // dual = marey + linked map, spiralSimulation = spiral simulation
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
    journeyPatterns: [],
    mareyHeightMultiplier: 5,
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

// Load the available journey patterns within this group of lines
const loadAvailableJourneyPatterns = () => {
  fetch(getSelectedDatasetURL())
    .then(r => r.json())
    .then((data) => {
      const jpSelect = document.getElementById('journeyPattern');
      // Remove the currently available journey patterns
      jpSelect.innerHTML = '';
      // Add the new journey patterns
      for (const journeyPattern of Object.keys(data.journeyPatterns)) {
        const nTrips = Object.entries(data.vehicleJourneys).filter(([, VJdata]) =>
          VJdata.journeyPatternRef === journeyPattern).length;
        jpSelect.innerHTML += `<option value="${journeyPattern}">${journeyPattern} - ${nTrips}</option>`;
      }
    });
};

// Process the index file populating the sidebar with the available parameters,
// as soon as it is loaded
const processIndex = () => {
  const publications = indexData.publications.reverse();

  const modeSelect = document.getElementById('mode');
  modeSelect.onchange = () => {
    if (modeSelect.value === 'dual') {
      document.getElementsByClassName('jpSelect')[0].style.display = 'block';
    } else {
      document.getElementsByClassName('jpSelect')[0].style.display = 'none';
    }
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
    loadAvailableJourneyPatterns();
  };

  // Populate group of lines dropdown
  const linesGroupsSelect = document.getElementById('lines-groups');
  for (const dataset of publications[0].datasets) {
    const lines = dataset.lines.join(', ');
    linesGroupsSelect.innerHTML += `<option value="${dataset.filename}">${lines}</option>`;
  }
  // Update available journey patterns when group of line is picked
  linesGroupsSelect.onchange = loadAvailableJourneyPatterns;

  // Load the available journey patterns and make that dropdown visible
  loadAvailableJourneyPatterns();

  /* eslint no-new: "off" */
  // Fetch default dataset and create its corresponding visualization
  const defaultDatasetURL = `${publications[0].url}${publications[0].datasets[0].filename}`;
  Object.assign(options, { selectedDate: publications[0].date });
  fetch(defaultDatasetURL).then(r => r.json())
    .then((defaultData) => { new PTDS(defaultData, options); });
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
      if (selectedMode === 'dual') {
        options.mode = 'dual';
        options.dual.journeyPatterns = [document.getElementById('journeyPattern').value];
      } else {
        options.mode = 'spiralSimulation';
      }
      Object.assign(options, { selectedDate: document.getElementById('day').value });
      new PTDS(data, options);
    });
};

$(document).ready(() => {
  // As soon as the document is ready, fetch the index file
  const indexFileURL = 'https://services.opengeo.nl/ptds/index.json';
  fetch(indexFileURL).then(r => r.json())
    // Process the index file when finished loading it
    .then((data) => { indexData = data; processIndex(); });

  // Activate sidebar plugin
  $('#sidebar').simplerSidebar({
    init: 'opened',
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
