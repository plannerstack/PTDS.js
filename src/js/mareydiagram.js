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

    this._initialSetup(changeCallback);
    this.drawTrips();
  }

  /**
   * Initial setup of the visualization, including svg group creation,
   * scales creation, axes and timeline drawing.
   * @param  {Function} changeCallback - Callback for the timeline change event
   */
  _initialSetup(changeCallback) {
    this.tripTimeParse = d3.timeParse('%H:%M:%S');
    this.yAxisTimeFormat = d3.timeFormat('%H:%M');
    this.timelineTimeFormat = d3.timeFormat('%H:%M:%S');

    this._computeMinMaxTime();
    this._createGroups();
    this._createScales();
    this._drawYAxes();
    this._drawXAxis();
    this._createTimeline(changeCallback);
  }

  /**
   * Create x and y scales for the visualization, used to draw the axes and the trips
   */
  _createScales() {
    this.xScale = d3.scaleLinear()
      .domain([0, this.data.stopsDistances[this.data.stopsDistances.length - 1].distance])
      .range([0, this.dims.innerWidth]);
    this.yScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.innerHeight]);
  }

  /**
   * Create the SVG groups containing the axes and the trips
   */
  _createGroups() {
    this.yLeftAxisGroup = this.svgObject.append('g')
      .attr('class', 'left-axis axis');
    this.yRightAxisGroup = this.svgObject.append('g')
      .attr('class', 'right-axis axis')
      .attr('transform', `translate(${this.dims.innerWidth},0)`);
    this.tripsGroup = this.svgObject.append('g')
      .attr('id', 'trips');
  }

  /**
   * Compute the minimum and maximum time of the trips contained in the dataset,
   * to know the domain of the y axis
   */
  _computeMinMaxTime() {
    // As base values for min and max time we use the first and
    // last time in the schedule of the first trip
    const firstTripSchedule = this.data.trips[0].tripSchedule;
    let [minTimeParsed, maxTimeParsed] = [
      this.tripTimeParse(firstTripSchedule[0].time),
      this.tripTimeParse(firstTripSchedule[firstTripSchedule.length - 1].time),
    ];

    // Iterate over all the trips to find minimum and maximum time
    for (const { tripSchedule } of this.data.trips) {
      const firstTimeParsed = this.tripTimeParse(tripSchedule[0].time);
      const lastTimeParsed = this.tripTimeParse(tripSchedule[tripSchedule.length - 1].time);
      if (firstTimeParsed < minTimeParsed) minTimeParsed = firstTimeParsed;
      if (lastTimeParsed > maxTimeParsed) maxTimeParsed = lastTimeParsed;
    }

    this.minTime = minTimeParsed;
    this.maxTime = maxTimeParsed;
  }

  /**
   * Vertical axes drawing, left and right
   */
  _drawYAxes() {
    const yLeftAxis = d3.axisLeft(this.yScale)
      .ticks(d3.timeMinute.every(20))
      .tickFormat(this.yAxisTimeFormat);

    const yRightAxis = d3.axisRight(this.yScale)
      .ticks(d3.timeMinute.every(20))
      .tickFormat(this.yAxisTimeFormat);

    this.yLeftAxisGroup.call(yLeftAxis);
    this.yRightAxisGroup.call(yRightAxis);
  }

  /**
   * Horizontal axis drawing
   */
  _drawXAxis() {
    const xAxis = d3.axisTop(this.xScale)
      .tickSize(-this.dims.innerHeight)
      .tickValues(this.data.stopsDistances.map(({ distance }) => distance))
      .tickFormat((_, index) => this.data.stopsDistances[index].stopCode);

    // Top axis element creation
    const xAxisGroup = this.svgObject.append('g')
      .attr('class', 'top-axis axis');

    xAxisGroup.call(xAxis);

    xAxisGroup.selectAll('text')
      .attr('y', 0)
      .attr('x', 5)
      .attr('dy', '.35em');

    const mareyContainerDOM = document.getElementById('marey-container');

    mareyContainerDOM.addEventListener('scroll', () => {
      xAxisGroup.node().setAttribute('transform', `translate(0,${mareyContainerDOM.scrollTop})`);
    }, false);
  }

  /**
   * Create the horizontal line representing the timeline
   * and make it move when the mouse is hovered in the canvas
   * @param  {Function} changeCallback - Callback to trigger when the timeline is moved
   */
  _createTimeline(changeCallback) {
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
        const formattedTime = this.timelineTimeFormat(time);

        // Trigger the callback
        changeCallback(formattedTime);

        // Update the y position of the timeline group
        d3.select('g.timeline').attr('transform', `translate(0,${yPos})`);
        // Update the text showing the time
        d3.select('g.timeline text').text(formattedTime);
      });
  }

  /**
   * Draw the trips on the diagram
   */
  drawTrips() {
    const trips = this.tripsGroup.selectAll('g.trip')
      .data(this.data.trips);

    const tripLineGenerator = d3.line()
      .x(({ distance }) => this.xScale(distance))
      .y(({ time }) => this.yScale(this.tripTimeParse(time)));

    trips.enter().append('g')
      .attr('class', 'trip')
      .attr('data-tripcode', ({ tripCode }) => tripCode)
      .append('path')
      .attr('d', ({ tripSchedule }) => tripLineGenerator(tripSchedule));
  }
}
