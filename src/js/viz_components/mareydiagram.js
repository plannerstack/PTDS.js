import { timeParse, timeFormat } from 'd3-time-format';
import { scaleLinear, scaleTime } from 'd3-scale';
import { axisLeft, axisTop, axisRight } from 'd3-axis';
import { timeMinute, timeSecond } from 'd3-time';
import { select, mouse, event as d3event } from 'd3-selection';
import { line } from 'd3-shape';
import { zoom, zoomIdentity } from 'd3-zoom';
import { brushY } from 'd3-brush';
import { flatten } from 'lodash';

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
  zoom,
  brushY,
  timeSecond,
  zoomIdentity,
});

/**
 * This class manages the Marey diagram visualization.
 */
export default class MareyDiagram {
  /**
   *
   * @param {Object} journeyPatternMix - Information to draw on the diagram
   * @param {{diagram: Object, scroll: Object, stopSelection: Object}} svgGroups - SVG groups
   *   for the diagram, the scroll and the stop selection
   * @param {Object} dims - Dimensions of the diagram
   * @param {Function} changeCallback - Callback for the time change
   */
  constructor(journeyPatternMix, svgGroups, dims, changeCallback) {
    this.journeyPatternMix = journeyPatternMix;
    this.g = svgGroups;
    this.dims = dims;

    // Compute information needed to draw the trips
    this.trips = this.computeTrips();
    // Perform initial set-up of the diagram
    this.initialSetup(changeCallback);
    // Draw the trips in the diagram
    this.drawTrips();
  }

  /**
   * Computes the time boundaries for the diagram, looking at the fist and last time of
   * all the trips of all the journey patterns displayed
   */
  computeTimeBoundaries() {
    const allJourneyPatterns = [
      this.journeyPatternMix.referenceJP,
      ...this.journeyPatternMix.otherJPs.map(({ journeyPattern }) => journeyPattern),
    ];

    let minTime = allJourneyPatterns[0].firstAndLastTimes.first;
    let maxTime = allJourneyPatterns[0].firstAndLastTimes.last;

    for (const journeyPattern of allJourneyPatterns) {
      const { firstAndLastTimes: { first, last } } = journeyPattern;
      if (first < minTime) minTime = first;
      if (last > maxTime) maxTime = last;
    }

    this.minTime = minTime;
    this.maxTime = maxTime;
  }

  /**
   * Initial setup of the visualization, including SVG group creation,
   * scales creation, axes and timeline drawing.
   * @param  {Function} changeCallback - Callback for the timeline change event
   */
  initialSetup(changeCallback) {
    // Time formatter for the timeline tooltip
    this.timelineTimeFormat = d3.timeFormat('%H:%M:%S');

    this.computeTimeBoundaries();

    // Expand the time boundaries by 10 minutes to improve readability of the diagram
    this.minTime = d3.timeMinute.offset(this.minTime, -10);
    this.maxTime = d3.timeMinute.offset(this.maxTime, +10);

    // Rectangle that clips the trips, so that when we zoom they don't
    // end up outside of the main diagram
    this.g.diagram.append('clipPath')
      .attr('id', 'clip-path')
      .append('rect')
      .attr('y', -60)
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight + 60);
    this.g.diagram.append('clipPath')
      .attr('id', 'clip-path-trips')
      .append('rect')
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight);

    // Line generator for the static schedule of a trip
    this.tripLineGenerator = d3.line()
      .x(({ distance }) => this.xScale(distance))
      .y(({ time }) => this.yScale(time));

    // Overlay to capture mouse events (movement of the timeline, zoom/pan)
    this.overlay = this.g.diagram.append('rect')
      .attr('class', 'overlay-mouse')
      .attr('width', this.dims.marey.innerWidth)
      .attr('height', this.dims.marey.innerHeight);

    this.createScales();
    this.createGroups();
    this.drawXAxis();
    this.drawYAxes();

    this.createTimeline(changeCallback);
    this.zoomAndBrushSetup();
  }

  /**
   * Number of seconds in the selected domain of the Marey diagram
   * @return {Number} - Seconds in selected domain of the Marey diagram
   */
  get secondsInSelectedDomain() {
    const ySelectedDomain = this.yScale.domain();
    return (ySelectedDomain[1] - ySelectedDomain[0]) / 1000;
  }

  /**
   * Time formatter for the ticks of the y axis
   * By default formats the time in HH:MM but when zoomed in
   * so that the time interval shown is smaller than 15 minutes
   * it formats it in HH:MM:SS, i.e. displaying also the seconds.
   * @return {Function} - Time formatter
   */
  get yAxisTimeFormatter() {
    if (this.secondsInSelectedDomain < 15 * 60) return d3.timeFormat('%H:%M:%S');
    return d3.timeFormat('%H:%M');
  }

  /**
   * Set up the zoom and brush behaviours
   */
  zoomAndBrushSetup() {
    // Since we haven't selected a range yet, this will get the domain of the entire day
    const minutesInTotalDomain = Math.floor(this.secondsInSelectedDomain / 60);
    this.zoomBehaviour = d3.zoom()
      // Base maximum zoom on the number of minutes in the domain for the current day.
      // The 1.6667 constant is empirically determined so that at the maximum zoom level
      // the granularity is seconds.
      .scaleExtent([1, minutesInTotalDomain * 1.6667])
      .extent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      .translateExtent([[0, 0], [this.dims.marey.innerWidth, this.dims.marey.innerHeight]])
      // We encapsulate this.zoomed in a closure so that we don't lose the "this" context
      .on('zoom', () => { this.zoomed(); });
    // Attach zoom behaviour to SVG group
    this.g.diagram.call(this.zoomBehaviour);

    this.brushBehaviour = d3.brushY()
      .extent([[-10, 0], [10, this.dims.mareyScroll.height]])
      // Same as above
      .on('brush end', () => { this.brushed(); });

    // Select the first two hours in the domain in the beginning
    let [initialEndTime] = this.yScrollScale.domain();
    initialEndTime.setHours(initialEndTime.getHours() + 2);
    // If the total domain is less than two hours, select the entire domain
    if (initialEndTime > this.yScrollScale.domain()[1]) {
      [, initialEndTime] = this.yScrollScale.domain();
    }

    // Attach brush behaviour to SVG group and set initial selection
    this.g.scroll
      .call(this.brushBehaviour)
      .call(this.brushBehaviour.move, [0, this.yScrollScale(initialEndTime)]);

    this.stopSelectionBehavior = d3.brushY()
      .extent([[-10, 0], [10, this.dims.mareyStopSelection.height]])
      .on('end', () => { this.brushedStops(); });

    this.g.stopSelection
      .call(this.stopSelectionBehavior)
      .call(this.stopSelectionBehavior.move, [0, this.yStopSelScale.range()[1]]);
  }

  /**
   * Handle the brush selection
   */
  brushed() {
    // When the zoom event is triggered, the zoom handler triggers a brush event to sync
    // the two parts, but we don't want to handle the brush as usual in that case
    if (d3event.sourceEvent && d3event.sourceEvent.type === 'zoom') return;

    // Get the brush selection
    const { selection } = d3event;

    // If the selection is empty, select the full range
    if (!selection) {
      this.g.scroll.call(
        this.brushBehaviour.move,
        this.yScrollScale.range(),
      );
      return;
    }

    // Make it impossible to perform a 0px selection
    if (selection[0] === selection[1]) {
      this.g.scroll.call(
        this.brushBehaviour.move,
        [selection[0], selection[0] + 1],
      );
      return;
    }

    // Update the Marey y scale domain
    this.yScale.domain(selection.map(this.yScrollScale.invert));

    // Update marey axes
    this.refreshYAxes();

    // Update the timeline
    this.updateTimeline();

    // Update the trips
    this.drawTrips();

    // Sync the zoom transform
    const zoomTransform = d3.zoomIdentity
      .scale(this.dims.mareyScroll.height / (selection[1] - selection[0]))
      .translate(0, -selection[0]);
    this.g.diagram.call(this.zoomBehaviour.transform, zoomTransform);

    // Update the transform scale
    this.lastK = this.dims.mareyScroll.height / (selection[1] - selection[0]);
  }

  /**
   * Stop selection brush handler
   */
  brushedStops() {
    if (!d3event.sourceEvent) return;

    // Get the brush selection
    const { selection } = d3event;
    const transitionDuration = 500;

    // If the selection is empty, select the full range
    if (!selection) {
      this.g.stopSelection.call(
        this.stopSelectionBehavior.move,
        this.yStopSelScale.range(),
      );
      return;
    }

    // Get new domain from selection
    let newDomain = selection.map(this.yStopSelScale.invert);

    // Get the closest stop to a given distance
    const getClosestStop = (goalDistance) => {
      let minDelta = { delta: Number.MAX_SAFE_INTEGER, index: -1, distance: -1 };
      for (const [index, distance] of this.journeyPatternMix.referenceJP.distances.entries()) {
        const currentDelta = Math.abs(distance - goalDistance);
        if (currentDelta < minDelta.delta) minDelta = { delta: currentDelta, index, distance };
      }
      return minDelta;
    };

    // Round the selection to the stops
    newDomain = newDomain.map(getClosestStop);

    // If the user tried to select a single stop, fix that
    if (newDomain[0].distance === newDomain[1].distance) {
      const referenceJPdistances = this.journeyPatternMix.referenceJP.distances;
      // If we're not at the end of the domain, select as the end stop the next one
      if (newDomain[1].index < referenceJPdistances.length - 1) {
        newDomain[1].index += 1;
        newDomain[1].distance = referenceJPdistances[newDomain[1].index];
      // If we're at the end, select as the previous stop the previous one
      } else {
        newDomain[0].index -= 1;
        newDomain[0].distance = referenceJPdistances[newDomain[0].index];
      }
    }

    // Update the selection
    this.g.stopSelection
      .transition().duration(transitionDuration)
      .call(
        this.stopSelectionBehavior.move,
        newDomain.map(({ distance }) => distance).map(this.yStopSelScale),
      );

    // Update the Marey x scale domain
    this.xScale.domain(newDomain.map(({ distance }) => distance));

    // Update the x axis
    this.drawXAxis(transitionDuration);

    // Update the trips
    this.drawTrips(transitionDuration);
  }

  /**
   * Refresh the axes after changing the scale and/or the ticks
   */
  refreshYAxes() {
    this.yLeftAxis.tickFormat(this.yAxisTimeFormatter);
    this.yRightAxis.tickFormat(this.yAxisTimeFormatter);
    this.yLeftAxisG.call(this.yLeftAxis.scale(this.yScale));
    this.yRightAxisG.call(this.yRightAxis.scale(this.yScale));
  }

  /**
   * Handle the zoom/pan events on the diagram
   */
  zoomed() {
    if (d3event.sourceEvent) {
      // When the brush event is triggered, the brush handler
      // triggers a zoom event to sync the two parts,
      // but we don't want to handle the zoom in that case.
      if (['brush', 'end'].includes(d3event.sourceEvent.type)) return;

      // If the event is triggered by the scroll of the mouse wheel and the shift key
      // is not pressed, we interpret it as PAN
      if (d3event.sourceEvent.type === 'wheel' && !d3event.sourceEvent.shiftKey) {
        // Get the current domain in the Marey diagram y axis
        const selectedDomain = this.yScale.domain();
        // Compute number of seconds in the selected domain
        const secondsInSelectedDomain = (selectedDomain[1] - selectedDomain[0]) / 1000;
        // Get the delta (= amount of scroll) of the event
        let delta = d3event.sourceEvent.deltaY;
        // If deltaMode = 1, the delta amount is given in lines and not pixels. (Firefox specific)
        // The conversion factor between lines and pixels is roughly 18. (1 line = 18 pixels)
        delta *= d3event.sourceEvent.deltaMode === 1 ? 18 : 1;
        // Constant setting the scroll speed. The bigger the constant, the faster.
        const scrollFactor = 0.001;
        // Compute the number of seconds by which the selected domain will be panned/moved
        const step = Math.floor(delta * secondsInSelectedDomain * scrollFactor);
        // The tentative new selected domain
        const newDomain = [
          d3.timeSecond.offset(selectedDomain[0], step),
          d3.timeSecond.offset(selectedDomain[1], step),
        ];

        // The original domain, i.e. first and last times in the dataset
        const originalDomain = this.yScrollScale.domain();

        // If we're trying to pan back in time and we're already on the upper border,
        // or forward in time and we're at the lower border, stop
        if ((newDomain[0] === originalDomain[0] && delta < 0) ||
            (newDomain[1] === originalDomain[1] && delta > 0)) return;

        // If the new domain is outside of the upper bound, set its start at the upper border
        if (newDomain[0] < originalDomain[0]) {
          [newDomain[0]] = originalDomain;
          newDomain[1] = d3.timeSecond.offset(newDomain[0], secondsInSelectedDomain);
        }
        // If the new domain is outside of the lower bound, set its start at the lower border
        if (newDomain[1] > originalDomain[1]) {
          [, newDomain[1]] = originalDomain;
          newDomain[0] = d3.timeSecond.offset(newDomain[1], -secondsInSelectedDomain);
        }

        // Update the selected domain
        this.yScale.domain(newDomain);

        // Update the zoom transform information. By default mouse wheel is used for zoom
        // so the transform will be updated by d3 as if we zoomed into the graph. Since
        // we are instead mapping the mouse wheel event to the panning, we have to manually
        // force update the zoom transform information.
        // The scale does not change (we're only panning, not zooming) and we therefore force
        // to the scale value the last known one (lastK).
        const zoomTransform = d3.zoomIdentity
          .scale(this.lastK)
          .translate(0, -this.yScrollScale(newDomain[0]));
        this.g.diagram.call(this.zoomBehaviour.transform, zoomTransform);
      } else {
        // If shift key is pressed, ZOOM.
        // Update the last known scale K value
        this.lastK = d3event.transform.k;
        this.yScale = d3event.transform.rescaleY(this.yScrollScale);
      }
    }

    // Update the brush selection
    this.g.scroll.call(
      this.brushBehaviour.move,
      this.yScale.domain().map(this.yScrollScale),
    );

    // Update the Marey y axes
    this.refreshYAxes();

    // Update the timeline
    this.updateTimeline();

    // Update the trips
    this.drawTrips();
  }

  /**
   * Create x and y scales for the visualization, used to draw the axes and the trips
   */
  createScales() {
    const referenceJPstopsDistances = this.journeyPatternMix.referenceJP.distances;
    const lastStopDistance = referenceJPstopsDistances[referenceJPstopsDistances.length - 1];
    this.xScale = d3.scaleLinear()
      .domain([0, lastStopDistance])
      .range([0, this.dims.marey.innerWidth]);
    this.yStopSelScale = d3.scaleLinear()
      .domain([0, lastStopDistance])
      .range([0, this.dims.mareyStopSelection.height]);
    this.yScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.marey.innerHeight]);
    this.yScrollScale = d3.scaleTime()
      .domain([this.minTime, this.maxTime])
      .range([0, this.dims.mareyScroll.height]);
  }

  /**
   * Create the SVG groups for the elements of the visualization.
   * In SVG the order of painting determines the "z-index" of the elements
   * so by changing the order of group creation we can adjust their "z-index".
   */
  createGroups() {
    this.xAxisG = this.g.diagram.append('g')
      .attr('class', 'top-axis axis')
      .attr('clip-path', 'url(#clip-path)');
    this.yLeftAxisG = this.g.diagram.append('g')
      .attr('class', 'left-axis axis');
    this.yRightAxisG = this.g.diagram.append('g')
      .attr('class', 'right-axis axis')
      .attr('transform', `translate(${this.dims.marey.innerWidth},0)`);
    this.yScrollAxisG = this.g.scroll.append('g')
      .attr('class', 'scroll-axis axis');
    this.yStopSelAxisG = this.g.stopSelection.append('g')
      .attr('class', 'stop-selection-axis axis');
    this.tripsG = this.g.diagram.append('g')
      .attr('class', 'trips')
      .attr('clip-path', 'url(#clip-path-trips)');
    this.timelineG = this.g.diagram.append('g')
      .attr('class', 'timeline');
  }

  /**
   * Vertical axes drawing, left and rights
   */
  drawYAxes() {
    this.yLeftAxis = d3.axisLeft(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

    this.yRightAxis = d3.axisRight(this.yScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

    this.yScrollAxis = d3.axisRight(this.yScrollScale)
      .ticks(20)
      .tickFormat(this.yAxisTimeFormatter);

    this.yStopSelAxis = d3.axisRight(this.yStopSelScale)
      .tickValues(this.journeyPatternMix.referenceJP.distances)
      .tickFormat((_, index) => {
        // Truncate the tick label if longer than maxChars chars
        const maxChars = 25;
        const stop = this.journeyPatternMix.referenceJP.stops[index];
        let label = `${stop.name}`;
        if (label.length > maxChars) label = `${label.substr(0, maxChars - 3)}...`;
        return label;
      });

    this.yLeftAxisG.call(this.yLeftAxis);
    this.yRightAxisG.call(this.yRightAxis);
    this.yScrollAxisG.call(this.yScrollAxis);
    this.yStopSelAxisG.call(this.yStopSelAxis);

    // Add circle to represent the stop in the stop selection brush
    this.yStopSelAxisG.selectAll('.tick').append('circle').attr('r', 3);
  }

  /**
   * Horizontal axis drawing
   * @param {number} transitionDuration - Duration of the transition
   */
  drawXAxis(transitionDuration = 0) {
    if (typeof this.xAxis === 'undefined') {
      this.xAxis = d3.axisTop(this.xScale)
        .tickSize(-this.dims.marey.innerHeight)
        .tickValues(this.journeyPatternMix.referenceJP.distances)
        .tickFormat((_, index) => this.journeyPatternMix.referenceJP.stops[index].name);
    }

    // Enhance vertical lines representing stops adding the stop code as attribute
    // to the SVG element and adding the "selected" CSS class to them when the mouse
    // cursor is positioned over
    const that = this;
    const bindTicksClick = () => {
      this.xAxisG.selectAll('.tick')
        .attr(
          'data-stop-area-code',
          (_, stopIndex) => this.journeyPatternMix.referenceJP.stops[stopIndex].area.code,
        )
        .on('mouseover', function f(_, stopIndex) {
          const stopAreaCode = that.journeyPatternMix.referenceJP.stops[stopIndex].area.code;
          // TODO: radius when selected and non selected (below) should be specified as a config
          // options somewhere else
          const selectedStopAreaRadius = 3;
          d3.select(`#map g.stopArea[data-stop-area-code='${stopAreaCode}'] circle`)
            .attr('r', selectedStopAreaRadius);
          d3.select(this).classed('selected', true);
        })
        .on('mouseout', function f(_, stopIndex) {
          const stopAreaCode = that.journeyPatternMix.referenceJP.stops[stopIndex].area.code;
          const deselectedStopAreaRadius = 1;
          d3.select(`#map g.stopArea[data-stop-area-code='${stopAreaCode}'] circle`)
            .attr('r', deselectedStopAreaRadius);
          d3.select(this).classed('selected', false);
        });
    };

    this.xAxisG
      .transition().duration(transitionDuration)
      .call(this.xAxis)
      .on('end', bindTicksClick);
  }

  /**
   * Create the horizontal line representing the timeline
   * and make it move when the mouse is hovered in the canvas
   * @param {Function} changeCallback - Callback to trigger when the timeline is moved
   */
  createTimeline(changeCallback = null) {
    // Initial position of the timeline
    const initialTimelineYpos = this.yScale(this.minTime);

    // Timeline initial position
    this.timelineG.attr('transform', `translate(0,${initialTimelineYpos})`);

    // Horizontal line drawing
    this.timelineG.append('line')
      .attr('x2', this.dims.marey.innerWidth)
      // Keep the line slightly below the mouse cursor so that it doesn't capture
      // all the mouse events, letting the elements "below" to listen to them
      .attr('y1', 1)
      .attr('y2', 1);

    // Label with the time
    this.timelineG.append('text')
      .text(this.timelineTimeFormat(this.minTime))
      .attr('x', 5)
      .attr('y', -5);

    // Register mouse movement listener.
    // Normally we would register the listener on the overlay, which
    // is the area that contains the timeline and the trips.
    // Doing that, though, means that elements with a "z-index" greater than
    // the overlay will get first the movement trigger, so that this handler would not be called.
    // Therefore we register the listener on the main group with all the SVG elements.
    this.updateTimeline = () => {
      // If the update is not triggered by an interaction, stop
      if (!(d3event.type === 'mousemove' || d3event.sourceEvent)) return;

      // Get the mouse position relative to the overlay
      // Using a closure we maintain the "this" context as the class instance,
      // but we don't have the DOM element reference so we have to get that manually.
      const [, yPos] = d3.mouse(this.overlay.node());
      // Since this handler is triggered also when the mouse cursor is not in the overlay,
      // we need to check that we are in it. It usually happens when we move the mouse
      // over the labels of the top axis, therefore we correct for that case.
      if (yPos < 0) return;

      // Get the time corresponding to the actual mouse position
      // and format it
      const time = this.yScale.invert(yPos);

      if (changeCallback) changeCallback(time);

      // Only update the vertical position to reflect the one of the mouse
      // if needed. With zoom and brush, we don't want to change the vertical
      // position. Only when the mouse is moved over the diagram
      if (d3event.type === 'mousemove') {
        // Update the y position of the timeline group
        this.timelineG.attr('transform', `translate(0,${yPos})`);
      }
      // Update the text showing the time
      this.timelineG.select('text').text(this.timelineTimeFormat(time));
    };
    this.g.diagram.on('mousemove', this.updateTimeline);
  }

  /**
   * Given a sequence of realtime positions, finds groups of positions that share status
   * and prognosis
   * @param {Array.<{
   *  time: Date,
   *  distance: number,
   *  status: string,
   *  prognosed: boolean}
   * >} sequence - Sequence of positions
   * @returns {Array.<{
   *  status: string,
   *  prognosis: boolean,
   *  positions: Array.<{time: Date, distance: number}>}
   * >} - Positions grouped by similarity
   */
  static getRealtimePaths(sequence) {
    const realtimePaths = {
      pathsList: [],
      startNewSequence: function f(position) {
        const { status, prognosed, ...barePosition } = position;
        this.pathsList.push({ status, prognosed, positions: [barePosition] });
      },
      addToLastSequence: function f(position) {
        const { status, prognosed, ...barePosition } = position;
        this.pathsList[this.pathsList.length - 1].positions.push(barePosition);
      },
      addPosition: function f(newPosition) {
        // If this is the first position we see, start a new sequence
        if (this.pathsList.length === 0) this.startNewSequence(newPosition);
        else {
          // If the status or prognosis of the new position are different from the
          // ones of the last sequence added, start a new sequence. Otherwise continue it.
          const lastAddedPath = this.pathsList[this.pathsList.length - 1];
          const breakCondition = (newPosition.prognosed !== lastAddedPath.prognosed ||
                                  newPosition.status !== lastAddedPath.status);

          this.addToLastSequence(newPosition);
          if (breakCondition) this.startNewSequence(newPosition);
        }
      },
    };

    for (const position of sequence) realtimePaths.addPosition(position);

    return realtimePaths.pathsList;
  }

  /**
   * Current approximation to use
   */
  get currentApproximation() {
    return {
      showDots: this.secondsInSelectedDomain < 60 * 60,
    };
  }

  /**
   * Compute information needed to draw the trips on the Marey diagram
   * @return {Array.<Object>} - Trip drawing information
   */
  computeTrips() {
    // Compute drawing information for the trips of the reference journey pattern
    const trips = this.journeyPatternMix.referenceJP.vehicleJourneys
      .map(({ code, staticSchedule, firstAndLastTimes, realTimeData }) => ({
        code,
        // For the reference journey pattern there is only one sequence
        staticSequences: [staticSchedule.map(({ time, distance }) => ({ time, distance }))],
        realtimeSequences: realTimeData.map(({ vehicleNumber, positions }) => ({
          vehicleNumber,
          // Again, only one sequence per vehicle for the reference journey pattern
          sequences: [positions.map(({ time, distanceFromStart, status, prognosed }) => ({
            time,
            distance: distanceFromStart,
            status,
            prognosed,
          }))],
        })),
        firstAndLastTimes,
      }));

    // Then compute the trip drawing information for the other journey patterns that share
    // at least one link with the reference JP
    for (const otherJP of this.journeyPatternMix.otherJPs) {
      // Iterate over the trips of the journey pattern
      for (const vehicleJourney of otherJP.journeyPattern.vehicleJourneys) {
        // Min and max time of every static/realtime position of the current journey,
        // only for the shared segments
        let minTime = null;
        let maxTime = null;

        // Update min and max time boundaries
        const updateTimeBoundaries = (time) => {
          if (minTime === null || time < minTime) minTime = time;
          if (maxTime === null || time > maxTime) maxTime = time;
        };

        const staticSequences = [];
        // For each trip of the "other" journey patterns, iterate over the sequences
        // shared with the reference journey pattern and add the corresponding "timinglinks"
        const { referenceSequences, otherSequences } = otherJP.sharedSequences;
        for (let i = 0; i < referenceSequences.length; i += 1) {
          const refSequence = referenceSequences[i];
          const otherSequence = otherSequences[i];

          staticSequences.push(refSequence.map((refIndex, j) => {
            // Index is multiplied by 2 because times array is twice the length as the distances one
            const time = vehicleJourney.times[otherSequence[j] * 2];
            updateTimeBoundaries(time);
            return {
              time,
              distance: this.journeyPatternMix.referenceJP.distances[refIndex],
            };
          }));
        }

        const realtimeSequences = [];
        // Iterate over each of the real time vehicles
        for (const { vehicleNumber, positions } of vehicleJourney.realTimeData) {
          const vehicleSequences = [];

          // Iterate over the shared sequence
          for (let i = 0; i < referenceSequences.length; i += 1) {
            // Filter out last stop of the sequence because it is not valid as "last stop"
            const refSequence = referenceSequences[i].slice(0, -1);
            const otherSequence = otherSequences[i].slice(0, -1);

            // For each shared sequence, add the positions data of the current trip by mapping
            // the distance relative to the last stop of the trip to the absolute distance
            // in the reference journey pattern
            const vehicleSequence = positions
              .filter(({ lastStopIndex }) => otherSequence.includes(lastStopIndex))
              .map(({ time, distanceSinceLastStop, lastStopIndex, status, prognosed }) => {
                // Find the index of the last stop before the current position
                // in the reference journey pattern
                const lastStopRefIndex = refSequence[otherSequence.indexOf(lastStopIndex)];
                // Get distance of last stop in the reference journey pattern
                const lastStopRefDistance = this.journeyPatternMix
                  .referenceJP
                  .distances[lastStopRefIndex];
                updateTimeBoundaries(time);

                return {
                  time,
                  status,
                  prognosed,
                  // Map the distance by adding the distance of the last stop in the reference
                  // journey pattern to the distance since the last stop
                  distance: distanceSinceLastStop + lastStopRefDistance,
                };
              });

            // Filter out sequences with zero length (can happen that a vehicle belonging to a
            // journey pattern that shares >1 link(s) with the reference one does not have any
            // positions to be drawn because the positions are not part of the shared links)
            if (vehicleSequence.length) vehicleSequences.push(vehicleSequence);
          }

          // Filter out vehicles without any position information (can happen that a vehicle
          // does not have any realtime position data)
          if (vehicleSequences.length) {
            realtimeSequences.push({
              vehicleNumber,
              sequences: vehicleSequences,
            });
          }
        }

        trips.push({
          code: vehicleJourney.code,
          staticSequences,
          realtimeSequences,
          firstAndLastTimes: { first: minTime, last: maxTime },
        });
      }
    }

    return trips;
  }

  /**
   * Draw the trips on the diagram
   * @param {number} transitionDuration - Duration of the transition in case of stop selection
   */
  drawTrips(transitionDuration) {
    // TODO: move these constants in a separate config file
    const selectedTripStaticStopRadius = 3;
    const selectedTripRTposRadius = 3;
    const selectedTripRadius = 6;
    const deSelectedTripStaticStopRadius = 2;
    const deSelectedTripRTposRadius = 2;
    const deSelectedTripRadius = 3;

    // Determines if a trip is in the currently selected domain
    const tripInSelectedDomain = (trip) => {
      const [minShownTime, maxShownTime] = this.yScale.domain();
      const { first: firstTripTime, last: lastTripTime } = trip.firstAndLastTimes;

      return (firstTripTime < minShownTime && lastTripTime > maxShownTime) ||
        (minShownTime < firstTripTime && firstTripTime < maxShownTime) ||
        (minShownTime < lastTripTime && lastTripTime < maxShownTime);
    };

    // Get all the trips in the currently selected domain
    const tripsInSelectedDomain = this.trips.filter(tripInSelectedDomain);

    // Trip selection
    const tripsSel = this.tripsG.selectAll('g.trip')
      .data(tripsInSelectedDomain, ({ code }) => code);

    // Trip exit
    tripsSel.exit().remove();

    // Get the overlay element from the class instance because we'll lose the "this" reference later
    const { overlay } = this;

    // Inside the trip events handlers the "this" context will be changed so we store a reference
    // to it in "that" to access it inside the functions
    const that = this;

    // Handler mouse over trip event
    // Classic function instead of () => {} because "this" context gets modified
    function tripMouseOver(trip) {
      // Get the SVG g element corresponding to this trip
      const tripSel = d3.select(this);
      // Get the current mouse position
      const [xPos, yPos] = d3.mouse(overlay.node());
      // Add label with the code of the trip next to the mouse cursor
      tripSel.append('text')
        .attr('class', 'tripLabel')
        .attr('x', xPos)
        .attr('y', yPos)
        .attr('dy', -10)
        .text(({ code }) => code);
      // Add 'selected' class to the trip SVG group
      tripSel.classed('selected', true);
      tripSel.selectAll('circle.static-stop').attr('r', selectedTripStaticStopRadius);
      tripSel.selectAll('circle.rt-position').attr('r', selectedTripRTposRadius);
      // In the map, highlight the vehicle
      d3.select(`#map g.trip[data-code='${trip.code}'] circle`).attr('r', selectedTripRadius);
    }

    // Handle mouse out of trip event
    function tripMouseOut(trip) {
      // Similarly as above
      const tripSel = d3.select(this);
      tripSel.select('text.tripLabel').remove();
      tripSel.classed('selected', false);

      tripSel.selectAll('circle.static-stop').attr('r', deSelectedTripStaticStopRadius);
      tripSel.selectAll('circle.rt-position').attr('r', deSelectedTripRTposRadius);
      d3.select(`#map g.trip[data-code='${trip.code}'] circle`).attr('r', deSelectedTripRadius);
    }

    // Handle click on a trip
    function tripClick(trip) {
      let { first, last } = trip.firstAndLastTimes;
      first = d3.timeMinute.offset(first, -1);
      last = d3.timeMinute.offset(last, +1);
      // Update zoom status to reflect change in domain
      that.g.diagram.call(that.zoomBehaviour.transform, d3.zoomIdentity
        .scale(that.lastK)
        .translate(0, -that.yScrollScale(first)));
      // Update brush status to reflect change in domain
      that.g.scroll
        .call(that.brushBehaviour.move, [
          that.yScrollScale(first),
          that.yScrollScale(last),
        ]);
      // Update Marey diagram domain
      that.yScale.domain([first, last]);
      tripMouseOut.call(this, trip);
    }

    // Trip enter
    const tripsEnterUpdateSel = tripsSel.enter().append('g')
      .attr('class', 'trip')
      .attr('data-trip-code', ({ code }) => code)
      .on('mouseover', tripMouseOver)
      .on('mouseout', tripMouseOut)
      .on('click', tripClick)
      // Trip enter + update
      .merge(tripsSel);

    // Trip enter + update > static sequences selection
    const staticSequencesSel = tripsEnterUpdateSel
      .selectAll('path.static-sequence')
      .data(({ staticSequences }) => staticSequences);

    // Trip enter + update > static sequences exit
    staticSequencesSel.exit().transition().duration(transitionDuration).remove();

    // Trip enter + update > static sequences enter
    staticSequencesSel.enter()
      .append('path')
      .attr('class', 'static-sequence')
      // Trip enter + update > static sequences enter + update
      .merge(staticSequencesSel)
      .transition()
      .duration(transitionDuration)
      .attr('d', schedule => this.tripLineGenerator(schedule));

    // Trip enter + update > static stops selection
    const staticStopsSel = tripsEnterUpdateSel
      .selectAll('circle.static-stop')
      .data(({ staticSequences }) =>
        (this.currentApproximation.showDots ? flatten(staticSequences) : []));

    // Trip enter + update > static stops exit
    staticStopsSel.exit().remove();

    // Trip enter + update > static stops enter
    staticStopsSel.enter()
      .append('circle')
      .attr('class', 'static-stop')
      .attr('r', deSelectedTripStaticStopRadius)
      .merge(staticStopsSel)
      .transition()
      .duration(transitionDuration)
      .attr('cx', ({ distance }) => this.xScale(distance))
      .attr('cy', ({ time }) => this.yScale(time));

    // Trip enter + update > realtime vehicle sequences selection
    const realtimeVehiclesSel = tripsEnterUpdateSel
      .selectAll('g.vehicle')
      .data(({ realtimeSequences }) => realtimeSequences);

    // Trip enter + update > realtime vehicle sequences exit
    realtimeVehiclesSel.exit().remove();

    // Trip enter + update > realtime vehicle sequences enter
    const realtimeVehiclesEnterUpdateSel = realtimeVehiclesSel.enter()
      .append('g')
      .attr('class', 'vehicle')
      .attr('data-vehicle-number', ({ vehicleNumber }) => vehicleNumber)
      // Trip enter + update > realtime vehicle sequences enter + update
      .merge(realtimeVehiclesSel);

    // Trip enter + update > realtime vehicle sequences > realtime link selection
    const realtimeVehiclesLinksSel = realtimeVehiclesEnterUpdateSel
    // const realtimeVehiclesEnterUpdateSel
      .selectAll('path.rt-sequence')
      // Compute the realtime links for each sequence and make a single array out of it
      .data(({ sequences }) =>
        flatten(sequences.map(sequence => MareyDiagram.getRealtimePaths(sequence))));

    // Trip enter + update > realtime vehicle sequences > realtime link exit
    realtimeVehiclesLinksSel.exit().remove();

    // // Trip enter + update > realtime vehicle sequences > realtime link enter
    realtimeVehiclesLinksSel.enter()
      .append('path')
      // Trip enter + update > realtime vehicle sequences > realtime link enter + update
      .merge(realtimeVehiclesLinksSel)
      .attr('class', ({ status }) => `rt-sequence ${status}`)
      .classed('prognosed', ({ prognosed }) => prognosed)
      .transition()
      .duration(transitionDuration)
      .attr('d', ({ positions }) => this.tripLineGenerator(positions));

    // Trip enter + update > realtime vehicle sequences > realtime position selection
    const realtimeVehiclesPositionsSel = realtimeVehiclesEnterUpdateSel
      .selectAll('circle.rt-position')
      // Draw the circles representing the positions only at the maximum zoom level
      .data(({ sequences }) => (this.currentApproximation.showDots ? flatten(sequences) : []));

    // Trip enter + update > realtime vehicle sequences > realtime position exit
    realtimeVehiclesPositionsSel.exit().remove();

    // Trip enter + update > realtime vehicle sequences > realtime position enter
    realtimeVehiclesPositionsSel.enter()
      .append('circle')
      .attr('class', ({ status }) => `rt-position ${status}`)
      .classed('prognosed', ({ prognosed }) => prognosed)
      .attr('r', deSelectedTripRTposRadius)
      .merge(realtimeVehiclesPositionsSel)
      .transition()
      .duration(transitionDuration)
      .attr('cx', ({ distance }) => this.xScale(distance))
      // Trip enter + update > realtime vehicle sequences > realtime position enter
      .attr('cy', ({ time }) => this.yScale(time));
  }
}
