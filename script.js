// Get browser dimensions
const window_width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth,
      window_height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

// D3 margin convention https://bl.ocks.org/mbostock/3019563
let margin = {top: 50, right: 50, bottom: 50, left: 50},
  width = window_width - margin.left - margin.right,
  height = window_height - margin.top - margin.bottom;

// Create main map SVG element applying the margins
let svg = d3.select('body').append('svg')
    .attr('id', 'map')
    .attr('width', width + margin.left + margin.right)
    .attr('height', height + margin.top + margin.bottom)
  .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/testData.json')
  .await((error, data) => {
    // Journey pattern that we want to display
    let journeyPatternShown = 'HTM:16:177';

    // Build the network project definition
    let projectNetwork = {};

    // Iterate over all the journey patterns to build the definition
    for (let [journeyPatternCode, journeyPatternData] of Object.entries(data.journeyPatterns)) {
      // Get list of stops of current journey pattern
      let stopsList = journeyPatternData.pointsInSequence;

      // Iterate over pairs of stops and add them to the project definition
      for (let i = 0; i < stopsList.length - 1; i++) {
        let stop1code = `HTM:${stopsList[i]}`, stop2code = `HTM:${stopsList[i+1]}`;

        // Get coordinates of current pair of stops
        let stop1data = data.scheduledStopPoints[stop1code],
          stop2data = data.scheduledStopPoints[stop2code];

        projectNetwork[`${stop1code}_${stop2code}`] = {
          'x1': stop1data.x, 'y1': stop1data.y,
          'x2': stop2data.x, 'y2': stop2data.y
        }
      }
    }

    // Given a journey pattern reference and the distance along that journey,
    // extracts the previous and next stops and computes the percentage of completion of the link between them
    function getVehiclePosition(journeyPatternRef, distance) {
      let journeyPatternData = data.journeyPatterns[journeyPatternRef];

      let lastStopIndex = -1;

      // Iterate over the journey pattern to find the previous and the next stop basing on the
      // current distance
      for (let i = 0; i < journeyPatternData.distances.length - 1; i++) {
        if (journeyPatternData.distances[i] <= distance && journeyPatternData.distances[i+1] > distance) {
          lastStopIndex = i;
          break;
        }
      }

      // Percentage of the distance between the previous and the next stop that is completed
      let percentage = (distance - journeyPatternData.distances[lastStopIndex]) / (journeyPatternData.distances[lastStopIndex+1] - journeyPatternData.distances[lastStopIndex]);

      return {
        'previousStopCode': journeyPatternData.pointsInSequence[lastStopIndex],
        'nextStopCode': journeyPatternData.pointsInSequence[lastStopIndex+1],
        'percentage': percentage
      }
    }

    // A trip is active if the time of the first stop is smaller (or equal) than the current time and
    // the time of the last stop if greater (or equal) than the current time
    let isActiveTrip = (trip, time) => (trip.times[0] <= time && trip.times[trip.times.length - 1] >= time);
    // Extraction of active trips
    let getActiveTrips = (time) => _.pickBy(data.vehicleJourneys, (trip) => isActiveTrip(trip, time));

    // Renders the map at a given time including only the given journeyPattern
    function renderMapAtTime(time, journeyPatternRef) {
      let activeTrips = getActiveTrips(time);
      let filteredActiveTrips = _.pickBy(activeTrips, (trip) => trip.journeyPatternRef == journeyPatternRef);

      for (let [tripCode, tripData] of Object.entries(filteredActiveTrips)) {
        // Find out the index corresponding to the latest time passed currently
        let lastTimeIndex = 0;
        for (let i = 0; i < tripData.times.length - 1; i++) {
          if (tripData.times[i+1] > time) {
            lastTimeIndex = i;
            break;
          }
        }

        // Compute percentage of time between previous and next stop by interpolation
        let percentage = (time - tripData.times[lastTimeIndex]) / (tripData.times[lastTimeIndex+1] - tripData.times[lastTimeIndex]);

        // Use the percentage to compute the actual distance of the vehicle by correspondence
        // to the distance list
        let currentDistance = tripData.distances[lastTimeIndex] + percentage * (tripData.distances[lastTimeIndex+1] - tripData.distances[lastTimeIndex]);

        // Get position of the vehicle in terms of previous stop, next stop and percentage of completion of the link between them
        let vehiclePosition = getVehiclePosition(tripData.journeyPatternRef, currentDistance);

        // Get coordinates of the link on which the vehicle is currently
        let currentLink = projectNetwork[`HTM:${vehiclePosition.previousStopCode}_HTM:${vehiclePosition.nextStopCode}`];

        // Compute the coordinates of the vehicle on the map
        let posX = currentLink.x1 + (currentLink.x2 - currentLink.x1) * vehiclePosition.percentage,
          posY = currentLink.y1 + (currentLink.y2 - currentLink.y1) * vehiclePosition.percentage;

        console.log(`Trip: ${tripCode}, Previous stop code: ${vehiclePosition.previousStopCode}, Next stop code: ${vehiclePosition.nextStopCode}, ` +
                    `Percentage: ${vehiclePosition.percentage}, PosX: ${posX}, PosY: ${posY}`);
      }
    }

    const time = 39000, jPattern = 'HTM:16:177';

    console.log(`Rendering trips for journey pattern ${jPattern} at time ${time}`)
    renderMapAtTime(time, jPattern);
});
