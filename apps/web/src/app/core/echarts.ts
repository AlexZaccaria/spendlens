// Tree-shaken ECharts build, loaded lazily by ngx-echarts the first time a chart renders,
// so the charting code stays out of the initial bundle.
import { BarChart, LineChart, TreemapChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { LabelLayout } from 'echarts/features';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([TreemapChart, BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, LabelLayout, SVGRenderer]);

export default echarts;
