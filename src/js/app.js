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
    paramB: 15,
  },
  // dual specific options
  dual: {
    verticalSplitPercentage: (Math.sqrt(5) - 1) / 2,
    journeyPatterns: ['HTM:17:139'],
    mareyHeightMultiplier: 20,
  },
};

const processIndex = (indexData) => {
  const publications = indexData.publications.reverse();

  const daySelect = document.getElementById('day');
  for (const publication of publications) {
    daySelect.innerHTML += `<option value="${publication.date}">${publication.date}</option>`;
  }

  const linesGroupsSelect = document.getElementById('lines-groups');
  for (const dataset of publications[0].datasets) {
    const lines = dataset.lines.join(', ');
    linesGroupsSelect.innerHTML += `<option value="${dataset.filename}">${lines}</option>`;
  }

  /* eslint no-new: "off" */
  const defaultDatasetURL = `${publications[0].url}${publications[0].datasets[0].filename}`;
  fetch(defaultDatasetURL).then(r => r.json())
    .then((defaultData) => { new PTDS(defaultData, options); });
};

$(document).ready(() => {
  $('#sidebar').simplerSidebar({
    init: 'opened',
    selectors: {
      trigger: '#toggle-sidebar',
    },
  });

  const indexFileURL = 'https://services.opengeo.nl/ptds/index.json';
  fetch(indexFileURL).then(r => r.json())
    .then(data => processIndex(data));

  document.getElementById('sidebar').style.visibility = 'visible';
  document.getElementById('navbar').style.visibility = 'visible';
  document.getElementById('options').onsubmit = (event) => {
    event.preventDefault();
  };
});
