// Get browser dimensions
const window_width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
const window_height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

// D3 margin convention https://bl.ocks.org/mbostock/3019563
const margin = {top: 50, right: 50, bottom: 50, left: 50};
const canvasWidth = window_width - margin.left - margin.right;
const canvasHeight = window_height - margin.top - margin.bottom;

// Create main map SVG element applying the margins
const svg = d3.select('body').append('svg')
    .attr('id', 'map')
    .attr('width', canvasWidth + margin.left + margin.right)
    .attr('height', canvasHeight + margin.top + margin.bottom)
  .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

/**
 * Class representing a generic point on the 2D plane
 */
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Computes the centroid of a sequence of points
   *
   * @param  {Array} points - Array of Point objects
   * @return {Point} point corresponding to the centroid of the given points
   */
  static centroid(points) {
    let totalX = 0;
    let totalY = 0;

    for (const point of points) {
      totalX += point.x;
      totalY += point.y;
    }

    const averageX = totalX / points.length;
    const averageY = totalY / points.length;

    return new Point(averageX, averageY);
  }
}

/**
 * Class representing a segment, with start and end point
 */
class Segment {
  constructor(pointA, pointB) {
    this.pointA = pointA;
    this.pointB = pointB;
  }

  /**
   * Computes a point along the segment given a percentage
   *
   * @param  {Number} percentage - Given a percentage [0.0-1.0] computes the corresponding point in the segment
   * @return {Point} Point corresponding to the percentage given
   */
  getPointByPercentage(percentage) {
    return new Point(
      this.pointA.x + (this.pointB.x - this.pointA.x) * percentage,
      this.pointA.y + (this.pointB.y - this.pointA.y) * percentage
    )
  }
}

/**
 * Main PTDS class
 */
class PTDS {
  constructor(inputData, canvasWidth, canvasHeight, canvasObject) {
    this.journeyPatterns = inputData.journeyPatterns;
    this.scheduledStopPoints = inputData.scheduledStopPoints;
    this.vehicleJourneys = inputData.vehicleJourneys;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this._computeCoordinatesMapping();
    this._computeStopAreasAggregation();
    this._computeProjectNetwork();

    // Radius used to draw the circle representing a stop
    this.stopRadius = 1;
  }

  /**
   * Computes the information needed to map the stops in the dataset
   * to the canvas
   */
  _computeCoordinatesMapping() {
    // First, we find the minimum and maximum coordinates of the stops in the grid
    this.stopsMinX = Number.MAX_VALUE;
    this.stopsMinY = Number.MAX_VALUE;
    this.stopsMaxX = Number.MIN_VALUE;
    this.stopsMaxY = Number.MIN_VALUE;

    // Iterate over all the stops first to find stopsMinX, stopsMinY, stopsMaxX, stopsMaxY
    for (const stopData of Object.values(this.scheduledStopPoints)) {
      if (stopData.x < this.stopsMinX) this.stopsMinX = stopData.x;
      if (stopData.y < this.stopsMinY) this.stopsMinY = stopData.y;
      if (stopData.x > this.stopsMaxX) this.stopsMaxX = stopData.x;
      if (stopData.y > this.stopsMaxY) this.stopsMaxY = stopData.y;
    }

    // Find out the aspect ratio of the rectangle containing all the stops
    // and of the canvas
    this.stopsGridAspectRatio = (this.stopsMaxX - this.stopsMinX) / (this.stopsMaxY - this.stopsMinY);
    this.canvasAspectRatio = this.canvasWidth / this.canvasHeight;
  }

  /**
   * Computes the aggregation of stops into stop areas
   */
  _computeStopAreasAggregation() {
    // Aggregate stops into stop areas
    let stopAreasAggregation = {};
    for (const [stopCode, stopData] of Object.entries(this.scheduledStopPoints)) {
      if (stopAreasAggregation.hasOwnProperty(stopData.area)) {
        stopAreasAggregation[stopData.area]['stops'][stopCode] = {
          'x': stopData.x,
          'y': stopData.y
        }
      } else {
        stopAreasAggregation[stopData.area] = {
          'name': stopData.name,
          'stops': {[stopCode]: {
              'x': stopData.x,
              'y': stopData.y
          }}
        };
      }
    }

    // Iterate over all the areas to compute coordinates of area as average of
    // the coordinates of the stops
    for (let stopAreaData of Object.values(stopAreasAggregation)) {
      // Create array of Points corresponding to the stops belonging to the current stop area
      const stopAreaStopsPoints = Object.values(stopAreaData.stops).map((stopData) =>
        new Point(stopData.x, stopData.y)
      );
      // Compute the centroid of the stop area
      const centroid = Point.centroid(stopAreaStopsPoints);
      stopAreaData['centroid'] = centroid;
    }

    this.stopAreasAggregation = stopAreasAggregation;
  }

  /**
   * Builds the project network definition, meaning the position in the canvas
   * of the segments representing the links between the stops
   */
  _computeProjectNetwork() {
    let projectNetwork = {};

    // Iterate over all the journey patterns to build the definition
    for (const journeyPatternData of Object.values(this.journeyPatterns)) {
      // Get list of stops of current journey pattern
      const stopsList = journeyPatternData.pointsInSequence;

      // Iterate over pairs of stops and add them to the project definition
      for (let i = 0; i < stopsList.length - 1; i++) {
        const stopAcode = `HTM:${stopsList[i]}`;
        const stopBcode = `HTM:${stopsList[i+1]}`;

        // Get coordinates of current pair of stops
        const stopAdata = this.scheduledStopPoints[stopAcode];
        const stopBdata = this.scheduledStopPoints[stopBcode];

        projectNetwork[`${stopAcode}|${stopBcode}`] = new Segment(
          new Point(stopAdata.x, stopAdata.y),
          new Point(stopBdata.x, stopBdata.y)
        );
      }
    }

    this.projectNetwork = projectNetwork;
  }

  /**
   * Maps a position in the Dutch grid to a position in the canvas
   * maximizing the dimension of the rectangle containing the stops but maintaining
   * the original aspect ratio.
   *
   * @param  {Point} point - The point in Dutch grid coordinates to map to the canvas coordinates
   * @return {Point} The point with coordinates in the canvas
   */
  _mapToCanvas(point) {
    if (this.stopsGridAspectRatio > this.canvasAspectRatio) {
      // Width is constrained to fit in the width of the canvas
      // Height is adapted consequently, keeping the same aspect ratio
      return new Point(
        (point.x - this.stopsMinX) * this.canvasWidth / (this.stopsMaxX - this.stopsMinX),
        (point.y - this.stopsMinY) * (this.canvasWidth / this.stopsGridAspectRatio) / (this.stopsMaxY - this.stopsMinY)
      );
    } else {
      // Height is constrained to fit the height of the canvas
      // Width is adapted consequently, keeping the same aspect ratio
      return new Point(
        (point.x - this.stopsMinX) * (this.canvasHeight * this.stopsGridAspectRatio)  / (this.stopsMaxX - this.stopsMinX),
        (point.y - this.stopsMinY) * this.canvasHeight / (this.stopsMaxY - this.stopsMinY)
      );
    }
  }
  /**
   * @param  {Object} trip - Data of a trip
   * @param  {Number} distance - Distance along the trip of the vehicle
   * @return {Point} Point in the map in which the vehicle is found now
   */
  _getTripPositionFromDistance(tripCode, distance) {
    const trip = this.vehicleJourneys[tripCode];
    const journeyPatternData = this.journeyPatterns[trip.journeyPatternRef];

    let lastStopIndex = -1;

    // Iterate over the journey pattern to find the previous and the next stop basing on the
    // current distance
    for (let i = 0; i < journeyPatternData.distances.length - 1; i++) {
      if (journeyPatternData.distances[i] <= distance && journeyPatternData.distances[i+1] > distance) {
        lastStopIndex = i;
        break;
      }
    }

    // Get the codes of the previous and next stop of the trip in the journey pattern
    const previousStopCode = journeyPatternData.pointsInSequence[lastStopIndex];
    const nextStopCode = journeyPatternData.pointsInSequence[lastStopIndex+1];

    // Percentage of the distance between the previous and the next stop that is completed
    const percentage = (distance - journeyPatternData.distances[lastStopIndex]) / (journeyPatternData.distances[lastStopIndex+1] - journeyPatternData.distances[lastStopIndex]);

    // Get segment of the network on which the vehicle is now
    const currentSegment = this.projectNetwork[`HTM:${previousStopCode}|HTM:${nextStopCode}`];

    return currentSegment.getPointByPercentage(percentage);
  }

  /**
   * Draws the stops in map as circles
   */
  drawStops() {
    // Draw the stops as circles
    for (const [stopCode, stopData] of Object.entries(this.scheduledStopPoints)) {
      const stopPoint = new Point(stopData.x, stopData.y);
      const stopPointInCanvas = this._mapToCanvas(stopPoint);

      svg.append("circle")
        .attr("cx", stopPointInCanvas.x)
        .attr("cy", stopPointInCanvas.y)
        .attr("r", this.stopRadius);
    }
  }

  /**
   * Draws the stop areas in the map as red bigger circles
   */
  drawStopAreas() {
    // Draw the stop areas as red bigger circles with 50% opacity
    for (const stopAreaData of Object.values(this.stopAreasAggregation)) {
      const stopAreaPoint = stopAreaData.centroid;
      const stopAreaPointInCanvas = this._mapToCanvas(stopAreaPoint);

      svg.append("circle")
        .attr("cx", stopAreaPointInCanvas.x)
        .attr("cy", stopAreaPointInCanvas.y)
        .attr("r", this.stopRadius * 2)
        .style("fill", 'red')
        .style("opacity", 0.5);
    }
  }
}

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/testData.json')
  .await((error, data) => {
    var ptds = new PTDS(data, canvasWidth, canvasHeight, svg);

    ptds.drawStops();
    ptds.drawStopAreas();
});
