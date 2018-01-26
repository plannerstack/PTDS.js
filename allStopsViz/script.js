// Get browser dimensions
const window_width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
const window_height = window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight;

// D3 margin convention https://bl.ocks.org/mbostock/3019563
const margin = {top: 50, right: 50, bottom: 50, left: 50};
const canvasWidth = window_width - margin.left - margin.right;
const canvasHeight = window_height - margin.top - margin.bottom;

// Radius used to draw the circle representing a stop
const stopRadius = 2;

// Create main map SVG element applying the margins
const svg = d3.select('body').append('svg')
    .attr('id', 'map')
    .attr('width', canvasWidth + margin.left + margin.right)
    .attr('height', canvasHeight + margin.top + margin.bottom)
  .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

// Load JSON data asynchronously
d3.queue()
  .defer(d3.json, 'data/testData.json')
  .await((error, data) => {
    // Since we want to draw the stops on the Dutch grid as big as possible in the canvas
    // but maintaining the original aspect ratio, first we find the minimum and maximum
    // coordinates of the stops in the grid
    let stopsMinX = Number.MAX_VALUE;
    let stopsMinY = Number.MAX_VALUE;
    let stopsMaxX = Number.MIN_VALUE;
    let stopsMaxY = Number.MIN_VALUE;

    // Iterate over all the stops first to find stopsMinX, stopsMinY, stopsMaxX, stopsMaxY
    for (const [stopCode, stopData] of Object.entries(data.scheduledStopPoints)) {
      if (stopData.x < stopsMinX) stopsMinX = stopData.x;
      if (stopData.y < stopsMinY) stopsMinY = stopData.y;
      if (stopData.x > stopsMaxX) stopsMaxX = stopData.x;
      if (stopData.y > stopsMaxY) stopsMaxY = stopData.y;
    }

    // Find out the aspect ratio of the grid containing all the stops
    // and of the canvas
    const stopsGridAspectRatio = (stopsMaxX - stopsMinX) / (stopsMaxY - stopsMinY);
    const canvasAspectRatio = canvasWidth / canvasHeight;

    // Function to map the coordinates from the Dutch grid to the canvas
    // using a linear mapping maintaining the original aspect ratio
    let mapToCanvas = (x, y) => {
      if (stopsGridAspectRatio > canvasAspectRatio) {
        // Width is constrained to fit in the width of the canvas
        // Height is adapted consequently, keeping the same aspect ratio
        return {
          'x': (x - stopsMinX) * canvasWidth / (stopsMaxX - stopsMinX),
          'y': (y - stopsMinY) * (canvasWidth / stopsGridAspectRatio) / (stopsMaxY - stopsMinY)
        };
      } else {
        // Height is constrained to fit the height of the canvas
        // Width is adapted consequently, keeping the same aspect ratio
        return {
          'x': (x - stopsMinX) * (canvasHeight * stopsGridAspectRatio)  / (stopsMaxX - stopsMinX),
          'y': (y - stopsMinY) * canvasHeight / (stopsMaxY - stopsMinY)
        };
      }
    };

    // Draw the stops as circles
    for (const [stopCode, stopData] of Object.entries(data.scheduledStopPoints)) {
      const stopCoordinateMapping = mapToCanvas(stopData.x, stopData.y);

      svg.append("circle")
        .attr("cx", stopCoordinateMapping.x)
        .attr("cy", stopCoordinateMapping.y)
        .attr("r", stopRadius);
    }
});
