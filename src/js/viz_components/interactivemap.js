import * as log from 'loglevel';

import Point from '../models/point';

/**
 * This class manages the map visualization.
 * The data/state stored by this class is kept at the minimum,
 * only the essential information needed to draw it is stored.
 */
export default class InteractiveMap {
  constructor(data, svgObject, dims, options) {
    this.data = data;
    this.svgObject = svgObject;
    this.dims = dims;
    this.options = options;

    this._createGroups();
    this._computeCoordinatesMapping();

    this.draw();
  }

  /**
   * Update the data/state of the map with a newer version
   * @param  {Object} newData - Object which properties will overwrite the existing ones.
   */
  updateData(newData) {
    Object.assign(this.data, newData);
  }

  /**
   * Draws the map, including: stops, stop areas, stops links and trips.
   */
  draw() {
    if (this.options.showStops) { this._drawStops(); }
    this._drawStopAreas();
    this._drawLinks();
    this._drawTrips();
  }

  /**
   * Create the SVG groups for links, stops, stopAreas and trips
   */
  _createGroups() {
    this.linksGroup = this.svgObject.append('g')
      .attr('id', 'links');
    this.stopsGroup = this.svgObject.append('g')
      .attr('id', 'stops');
    this.stopAreasGroup = this.svgObject.append('g')
      .attr('id', 'stopAreas');
    this.tripsGroup = this.svgObject.append('g')
      .attr('id', 'trips');
  }


  /**
   * Computes the information needed to map a point in the Dutch grid to a point in the canvas
   */
  _computeCoordinatesMapping() {
    // First, we find the minimum and maximum coordinates of the stops in the grid
    this.stopsMinX = Number.MAX_VALUE;
    this.stopsMinY = Number.MAX_VALUE;
    this.stopsMaxX = Number.MIN_VALUE;
    this.stopsMaxY = Number.MIN_VALUE;

    // Iterate over all the stops first to find stopsMinX, stopsMinY, stopsMaxX, stopsMaxY
    for (const { position } of this.data.stops) {
      if (position.x < this.stopsMinX) this.stopsMinX = position.x;
      if (position.y < this.stopsMinY) this.stopsMinY = position.y;
      if (position.x > this.stopsMaxX) this.stopsMaxX = position.x;
      if (position.y > this.stopsMaxY) this.stopsMaxY = position.y;
    }

    // Find out the aspect ratio of the rectangle containing all the stops
    // and of the canvas
    this.stopsGridAspectRatio = (this.stopsMaxX - this.stopsMinX) /
                                (this.stopsMaxY - this.stopsMinY);
    this.mapAspectRatio = this.dims.innerWidth / this.dims.innerHeight;
  }

  /**
   * Maps a position in the Dutch grid to a position in the canvas
   * maximizing the dimension of the rectangle containing the stops but maintaining
   * the original aspect ratio.
   * @param  {Point} point - The point in Dutch grid coordinates to map to the canvas coordinates
   * @return {Point} The point with coordinates in the canvas
   */
  _mapToCanvas(point) {
    if (this.stopsGridAspectRatio > this.mapAspectRatio) {
      // Width is constrained to fit in the width of the canvas
      // Height is adapted consequently, keeping the same aspect ratio
      const verticalCenteringAdjustment = (this.dims.innerHeight -
                                          (this.dims.innerWidth / this.stopsGridAspectRatio))
                                          / 2;
      const mappedPoint = new Point(
        ((point.x - this.stopsMinX) * this.dims.innerWidth) /
        (this.stopsMaxX - this.stopsMinX),
        (((point.y - this.stopsMinY) * (this.dims.innerWidth / this.stopsGridAspectRatio)) /
        (this.stopsMaxY - this.stopsMinY)) + verticalCenteringAdjustment,
      );

      // Mirror along horizontal axis
      mappedPoint.y = this.dims.innerHeight - mappedPoint.y;
      return mappedPoint;
    }

    // Height is constrained to fit the height of the canvas
    // Width is adapted consequently, keeping the same aspect ratio
    const horizontalCenteringAdjustment = (this.dims.innerWidth -
                                          (this.dims.innerHeight * this.stopsGridAspectRatio))
                                          / 2;
    const mappedPoint = new Point(
      (((point.x - this.stopsMinX) * (this.dims.innerHeight * this.stopsGridAspectRatio)) /
      (this.stopsMaxX - this.stopsMinX)) + horizontalCenteringAdjustment,
      ((point.y - this.stopsMinY) * this.dims.innerHeight) /
      (this.stopsMaxY - this.stopsMinY),
    );

    mappedPoint.y = this.dims.innerHeight - mappedPoint.y;
    return mappedPoint;
  }

  /**
   * Draws the stops
   */
  _drawStops() {
    // Stop selection
    const stopsSel = this.stopsGroup.selectAll('g.stop')
      .data(
        // Before binding the stops data to the selection,
        // we transform their position from dutch grid to canvas
        this.data.stops.map(({ code, position }) => ({
          code,
          position: this._mapToCanvas(position),
        })),
        // Use the stop code as key
        ({ code }) => code,
      );

    // Stop exit
    stopsSel.exit().remove();

    // Stop enter
    const stopsEnterSel = stopsSel.enter().append('g')
      .attr('class', 'stop')
      .attr('data-stop-code', ({ code }) => code);

    // Stop enter + update
    stopsEnterSel.merge(stopsSel)
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    // Stop enter > circle
    stopsEnterSel
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.stopRadius)
      .on('click', function f() {
        // Demo click event on stop
        const { code } = this.parentNode.dataset;
        log.info(`Clicked on stop ${code}`);
      });

    // Stop enter > text
    stopsEnterSel
      .append('text')
      .attr('x', 0)
      .attr('y', -1.5)
      .text(({ code }) => code);
  }

  /**
   * Draws the stop areas
   */
  _drawStopAreas() {
    // Stoparea selection
    const stopAreasSel = this.stopAreasGroup.selectAll('g.stopArea')
      .data(
        this.data.stopAreas.map(({ code, center }) => ({
          code,
          center: this._mapToCanvas(center),
        })),
        ({ code }) => code,
      );

    // Stoparea exit
    stopAreasSel.exit().remove();

    // Stoparea enter
    const stopAreasEnterSel = stopAreasSel.enter().append('g')
      .attr('class', 'stopArea')
      .attr('data-stop-area-code', ({ code }) => code);

    // Stoparea enter + update
    stopAreasEnterSel.merge(stopAreasSel)
      .attr('transform', ({ center }) => `translate(${center.x},${center.y})`);

    // Stoparea enter > circle
    stopAreasEnterSel
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.stopAreaRadius)
      .on('click', function f() {
        const { code } = this.parentNode.dataset;
        log.info(`Clicked on stop area ${code}`);
      });

    // Stoparea enter > text
    stopAreasEnterSel
      .append('text')
      .attr('x', 0)
      .attr('y', -1.5)
      .text(({ code }) => code);
  }

  /**
   * Draws the links
   */
  _drawLinks() {
    // Link selection
    const linkSel = this.linksGroup.selectAll('line.link')
      .data(
        // Similarly to what we did for stops and stopAreas, we
        // transform the segment to canvas position from Dutch grid
        // before binding it to the selection (and therefore drawing it)
        this.data.links.map(({ linkID, stop1, stop2 }) => ({
          linkID,
          stopArea1center: this._mapToCanvas(stop1.area.center),
          stopArea2center: this._mapToCanvas(stop2.area.center),
        })),
        ({ linkID }) => linkID,
      );

    // Link exit
    linkSel.exit().remove();

    // Link enter
    linkSel.enter().append('line')
      .attr('class', 'link')
      .attr('data-link-id', ({ linkID }) => linkID)
      .on('click', function f() {
        const { linkId } = this.dataset;
        log.info(`Clicked on link ${linkId}`);
      })
      // Link enter + update
      .merge(linkSel)
      .attr('x1', ({ stopArea1center }) => stopArea1center.x)
      .attr('y1', ({ stopArea1center }) => stopArea1center.y)
      .attr('x2', ({ stopArea2center }) => stopArea2center.x)
      .attr('y2', ({ stopArea2center }) => stopArea2center.y);
  }

  /**
   * Draw the trips
   */
  _drawTrips() {
    // Trip selection
    const tripsSel = this.tripsGroup.selectAll('g.trip')
      .data(this.data.trips, ({ tripCode }) => tripCode);

    // Trip exit
    tripsSel.exit().remove();

    // Trip enter
    tripsSel.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ tripCode }) => tripCode);

    // Trip > vehicle selection
    const vehicles = tripsSel.selectAll('g.vehicle')
      .data(({ vehiclePositions }) => vehiclePositions.map(({ vehicleNumber, position }) => ({
        vehicleNumber,
        position: this._mapToCanvas(position),
      })), ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle exit
    vehicles.exit().remove();

    // Trip > vehicle enter
    const vehiclesEnterSel = vehicles.enter()
      .append('g')
      .attr('class', 'vehicle')
      .attr('data-vehicle-number', ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle enter + update
    vehiclesEnterSel.merge(vehicles)
      .attr('transform', ({ position }) => `translate(${position.x},${position.y})`);

    // Trip > vehicle enter > circle
    vehiclesEnterSel
      .append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', this.options.tripRadius)
      .on('click', function f({ vehicleNumber }) {
        const { tripCode } = this.parentNode.parentNode.dataset;
        log.info(`Clicked on trip ${tripCode}, vehicleNumber ${vehicleNumber}`);
      });

    // Trip > vehicle enter > text
    vehiclesEnterSel
      .append('text')
      .attr('x', 0)
      .attr('y', 0)
      .text(function f() {
        return this.parentNode.parentNode.dataset.tripCode;
      });
  }
}
