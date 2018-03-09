import { timeParse, timeFormat } from 'd3-time-format';
import { scaleLinear, scaleTime } from 'd3-scale';
import { axisLeft, axisTop, axisRight } from 'd3-axis';
import { timeMinute } from 'd3-time';
import { select, mouse } from 'd3-selection';
import { line } from 'd3-shape';

const d3 = Object.assign({}, {
  timeParse,
  timeFormat,
  scaleLinear,
  scaleTime,
  axisLeft,
  axisTop,
  axisRight,
  timeMinute,
  mouse,
  select,
  line,
});

/**
 * This class manages the Marey diagram visualization.
 * The data/state stored by this class is kept at the minimum,
 * only the essential information needed to draw it is stored.
 */
export default class MareyDiagram {
  constructor(data, svgObject, dims, options, changeCallback) {
    this.data = data;
    this.svgObject = svgObject;
    this.dims = dims;
    this.options = options;

    this.initialSetup(changeCallback);
    this.drawTrips();
  }

  /**
   * Initial setup of the visualization, including svg group creation,
   * scales creation, axes and timeline drawing.
   * @param  {Function} changeCallback - Callback for the timeline change event
   */
  initialSetup(changeCallback) {
    this.tripTimeParse = d3.timeParse('%H:%M:%S');
    this.yAxisTimeFormat = d3.timeFormat('%H:%M');
    this.timelineTimeFormat = d3.timeFormat('%H:%M:%S');

    // Add 10 min offset to improve readability
    this.minTime = d3.timeMinute.offset(this.tripTimeParse(this.data.timeBoundaries.first), -10);
    this.maxTime = d3.timeMinute.offset(this.tripTimeParse(this.data.timeBoundaries.last), +10);

    // Rectangle that clips the trips, so that when we zoom they don't
    // end up out of the main graph
    this.svgObject.append('clipPath')
      .attr('id', 'clip-path')
      .append('rect')
      // Use a 5px margin on the sides so that the circles representing the stops
      // are entirely visible
      .attr('x', -5)
      .attr('width', this.dims.innerWidth + 5)
      .attr('height', this.dims.innerHeight);

    // Line generator for the static schedule of a trip
    this.tripLineGenerator = d3.line()
      .x(({ distance }) => this.xScale(distance))
      .y(({ time }) => this.yScale(this.tripTimeParse(time)));

    this.createScales();
    this.createGroups();
    this.drawXAxis();
    this.drawYAxes();
    this.createTimeline(changeCallback);
  }

  /**
   * Handle diagram zoom
   * @param  {Transform} transform - Transform object
   */
  zoomed(transform) {
    // Compute new y scale, rescaling the original one
    this.yScale = transform.rescaleY(this.originalYscale);

    // Update y axes (left and right)
    this.yLeftAxisG.call(this.yLeftAxis.scale(this.yScale));
    this.yRightAxisG.call(this.yRightAxis.scale(this.yScale));

    // Update stops, trips, links, etc
    this.tripsG.selectAll('circle.scheduledStop')
      .attr('cy', ({ time }) => this.yScale(this.tripTimeParse(time)));
    this.tripsG.selectAll('g.trip').select('path')
      .attr('d', ({ schedule }) => this.tripLineGenerator(schedule));
    this.tripsG.selectAll('line.pos-link')
      .attr('y1', ({ timeA }) => this.yScale(this.tripTimeParse(timeA)))
      .attr('y2', ({ timeB }) => this.yScale(this.tripTimeParse(timeB)));
    this.tripsG.selectAll('circle.position')
      .attr('cy', ({ time }) => this.yScale(this.tripTimeParse(time)));
  }

  /**
   * Create x and y scales for the visualization, used to draw the axes and the trips
   */
  createScales() {
    this.xScale = d3.scaleLinear()
      .domain([0, this.data.stopsDistances[this.data.stopsDistances.length - 1].distance])
      .range([0, this.dims.innerWidth]);
    this.yScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.innerHeight]);
    // Keep a separate copy of the y scale which will never be modified,
    // to use in the zoom handling
    this.originalYscale = this.yScale.copy();
  }

  /**
   * Create the SVG groups containing the axes and the trips
   */
  createGroups() {
    this.yLeftAxisG = this.svgObject.append('g')
      .attr('class', 'left-axis axis');
    this.yRightAxisG = this.svgObject.append('g')
      .attr('class', 'right-axis axis')
      .attr('transform', `translate(${this.dims.innerWidth},0)`);
    this.tripsG = this.svgObject.append('g')
      .attr('class', 'trips')
      .attr('clip-path', 'url(#clip-path)');
    this.xAxisG = this.svgObject.append('g')
      .attr('class', 'top-axis axis');
  }

  /**
   * Vertical axes drawing, left and right
   */
  drawYAxes() {
    this.yLeftAxis = d3.axisLeft(this.yScale)
      .ticks(this.options.dual.mareyHeightMultiplier * 20)
      .tickFormat(this.yAxisTimeFormat);

    this.yRightAxis = d3.axisRight(this.yScale)
      .ticks(this.options.dual.mareyHeightMultiplier * 20)
      .tickFormat(this.yAxisTimeFormat);

    this.yLeftAxisG.call(this.yLeftAxis);
    this.yRightAxisG.call(this.yRightAxis);
  }

  /**
   * Horizontal axis drawing
   */
  drawXAxis() {
    this.xAxis = d3.axisTop(this.xScale)
      .tickSize(-this.dims.innerHeight)
      .tickValues(this.data.stopsDistances.map(({ distance }) => distance))
      .tickFormat((_, index) => this.data.stopsDistances[index].stop.code);

    this.xAxisG.call(this.xAxis);

    this.xAxisG.selectAll('text')
      .attr('y', 0)
      .attr('x', 5)
      .attr('dy', '.35em');
  }

  /**
   * Create the horizontal line representing the timeline
   * and make it move when the mouse is hovered in the canvas
   * @param  {Function} changeCallback - Callback to trigger when the timeline is moved
   */
  createTimeline(changeCallback) {
    // Initial position of the timeline
    const initialTimelineYpos = this.yScale(this.minTime);

    // Timeline group creation
    const timeline = this.svgObject.append('g')
      .attr('class', 'timeline')
      .attr('transform', `translate(0,${initialTimelineYpos})`);

    // Horizontal line
    timeline.append('line')
      .attr('x1', 0)
      .attr('x2', this.dims.innerWidth);

    // Label with the time
    timeline.append('text')
      .text(this.timelineTimeFormat(this.minTime))
      .attr('x', 5)
      .attr('y', -5);

    // Create overlay to handle timeline movement with mouse
    this.svgObject.append('rect')
      .attr('id', 'mouse-move-overlay')
      .attr('width', this.dims.innerWidth)
      .attr('height', this.dims.innerHeight)
      .on('mousemove', () => {
        // d3.mouse wants a DOM element, so get it by its ID
        const overlay = document.getElementById('mouse-move-overlay');
        // Get the mouse position relative to the overlay
        const yPos = d3.mouse(overlay)[1];
        // Get the time corresponding to the actual mouse position
        // and format it
        const time = this.yScale.invert(yPos);
        const hhmmssTime = this.timelineTimeFormat(time);

        // If the schedule extends to the next day, we need to handle
        // manually the time conversion.
        // This should be considered a hack and the whole time handling
        // should be revised ASAP.
        if (d3.timeFormat('%j')(time) > 1) {
          const hh = parseInt(hhmmssTime.substr(0, 2), 10);
          const fixedHH = hh + 24;
          const fixedHHMMSSTime = `${fixedHH}:${hhmmssTime.substr(3)}`;
          changeCallback(fixedHHMMSSTime);
        } else {
          changeCallback(hhmmssTime);
        }

        // Update the y position of the timeline group
        d3.select('g.timeline').attr('transform', `translate(0,${yPos})`);
        // Update the text showing the time
        d3.select('g.timeline text').text(hhmmssTime);
      });
  }

  /**
   * Given a list of vehicle positions, get the links between them
   * @param  {Array.<{time: number, distance: number, status: string}>} positions - Positions info
   * @return {Array.<{timeA: number, timeB: number,
   *           distanceA: number, distanceB: number,
   *           status: string, prognosed: boolean}>} - Positions links information
   */
  static getPositionLinks(positions) {
    const posLinks = [];
    for (let index = 0; index < positions.length - 1; index += 1) {
      const posA = positions[index];
      const posB = positions[index + 1];
      const timeA = posA.time;
      const timeB = posB.time;
      const distanceA = posA.distance;
      const distanceB = posB.distance;

      const prognosed = posA.prognosed || posB.prognosed;

      posLinks.push({ timeA, timeB, distanceA, distanceB, status: posA.status, prognosed });
    }

    return posLinks;
  }

  /**
   * Draw the trips on the diagram
   */
  drawTrips() {
    // Trip selection
    const tripsSel = this.tripsG.selectAll('g.trip')
      .data(this.data.trips, ({ code }) => code);

    // Trip exit
    tripsSel.exit().remove();

    // Trip enter
    const tripsEnterSel = tripsSel.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ code }) => code);

    // Trip enter > path
    tripsEnterSel
      .append('path')
      .attr('d', ({ schedule }) => this.tripLineGenerator(schedule));

    // Trip enter > circle selection
    const tripsScheduledStopsSel = tripsEnterSel
      .selectAll('circle.scheduledStop')
      .data(({ schedule }) => schedule);

    // Trip enter > circle
    tripsScheduledStopsSel.enter()
      .append('circle')
      .attr('class', 'scheduledStop')
      .attr('r', '2')
      .attr('cx', ({ distance }) => this.xScale(distance))
      .attr('cy', ({ time }) => this.yScale(this.tripTimeParse(time)));

    // Trip enter > vehicle selection
    const vehiclesSel = tripsEnterSel.selectAll('g.vehicle')
      .data(({ vehicles }) => vehicles, ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle exit
    vehiclesSel.exit().remove();

    // Trip > vehicle enter,
    const vehiclesEnterSel = vehiclesSel.enter().append('g')
      .attr('class', 'vehicle')
      .attr('data-vehicle-n', ({ vehicleNumber }) => vehicleNumber);

    // Trip > vehicle enter + update
    const vehiclesEnterUpdateSel = vehiclesSel.merge(vehiclesEnterSel);

    // Trip > vehicle enter + update > circle
    const vehiclesPosSel = vehiclesEnterUpdateSel
      .selectAll('circle.position')
      .data(({ positions }) => positions, ({ index }) => index);

    // Trip > vehicle > circle enter
    vehiclesPosSel.enter()
      .append('circle')
      .attr('class', ({ status, prognosed }) => `position ${status} ${prognosed ? 'prognosed' : ''}`)
      .attr('r', '1')
      // Trip > vehicle > circle enter + update
      .merge(vehiclesPosSel)
      .attr('cx', ({ distance }) => this.xScale(distance))
      .attr('cy', ({ time }) => this.yScale(this.tripTimeParse(time)));

    // Trip > vehicle > line
    const vehiclesPosLinksSel = vehiclesEnterUpdateSel.selectAll('line.pos-link')
      .data(({ positions }) => MareyDiagram.getPositionLinks(positions));

    // Trip > vehicle > line enter
    vehiclesPosLinksSel.enter()
      .append('line')
      .attr('class', ({ status, prognosed }) => `pos-link ${status} ${prognosed ? 'prognosed' : ''}`)
      // Trip > vehicle > line enter + update
      .merge(vehiclesPosLinksSel)
      .attr('x1', ({ distanceA }) => this.xScale(distanceA))
      .attr('x2', ({ distanceB }) => this.xScale(distanceB))
      .attr('y1', ({ timeA }) => this.yScale(this.tripTimeParse(timeA)))
      .attr('y2', ({ timeB }) => this.yScale(this.tripTimeParse(timeB)));
  }
}
