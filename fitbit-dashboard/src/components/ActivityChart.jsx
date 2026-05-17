import React, { useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    AreaChart, Area, CartesianGrid
} from 'recharts';
import { Activity } from 'lucide-react';
import useMetricHistory from '../hooks/useMetricHistory';

const ActivityChart = ({ token, date, title = "Activity Trends", icon: Icon = Activity, metricType = 'steps', unit = 'steps', color = 'cyan', isDarkMode = true, onDateSelect }) => {
    const [range, setRange] = useState('week'); // 'day', 'week', 'month'
    const { data, loading, error } = useMetricHistory(token, localStorage.getItem('fitbit_refresh_token'), date, metricType, range);

    const formatDate = (dateStr) =>
        new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    // Color Maps
    const colorMap = {
        cyan: { stroke: '#06b6d4', fill: 'url(#colorCyan)', fillOp: 0.3 },
        rose: { stroke: '#f43f5e', fill: 'url(#colorRose)', fillOp: 0.3 },
        violet: { stroke: '#8b5cf6', fill: 'url(#colorViolet)', fillOp: 0.3 },
        amber: { stroke: '#f59e0b', fill: 'url(#colorAmber)', fillOp: 0.3 },
    };
    const theme = colorMap[color] || colorMap.cyan;

    const CustomTooltip = ({ active, payload, label }) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-gray-900 border border-gray-700 p-3 rounded-lg shadow-xl">
                    <p className="text-gray-400 text-xs mb-1">{formatDate(label)}</p>
                    <p className="font-bold text-lg" style={{ color: theme.stroke }}>
                        {payload[0].value.toLocaleString()} <span className="text-xs font-normal text-gray-500">{unit}</span>
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className={`p-6 rounded-xl border ${isDarkMode ? 'bg-gray-900 border-white/5' : 'bg-white border-slate-200'}`}>
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <div>
                    <h3 className={`text-sm font-bold flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                        <Icon className="w-4 h-4" style={{ color: theme.stroke }} />
                        {title}
                    </h3>
                </div>

                <div className="flex gap-1">
                    {['day', 'week', 'month'].map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${range === r
                                ? `text-white border-b-2 border-blue-500`
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            {r}
                        </button>
                    ))}
                </div>
            </div>

            <div className="h-[300px] w-full">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: theme.stroke }}></div>
                    </div>
                ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                        {range === 'day' && data.length > 1 ? (
                            <AreaChart data={data}>
                                <defs>
                                    <linearGradient id="colorCyan" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorRose" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorViolet" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                    </linearGradient>
                                    <linearGradient id="colorAmber" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    hide={true}
                                />
                                <YAxis
                                    stroke="#9ca3af"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#374151' }} />
                                <Area
                                    type="monotone"
                                    dataKey="value"
                                    stroke={theme.stroke}
                                    fillOpacity={1}
                                    fill={theme.fill}
                                    strokeWidth={2}
                                />
                            </AreaChart>
                        ) : (
                            <BarChart data={data} barSize={range === 'week' ? 40 : (data.length === 1 ? 80 : 12)}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                                <XAxis
                                    dataKey="label"
                                    stroke="#9ca3af"
                                    tickLine={false}
                                    axisLine={false}
                                    height={range === 'week' ? 50 : 30}
                                    onClick={(data) => onDateSelect?.(data.value)}
                                    tick={({ x, y, payload }) => {
                                        const label = range === 'month'
                                            ? new Date(payload.value + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
                                            : formatDate(payload.value);
                                        return (
                                            <g transform={`translate(${x},${y})`} style={{ cursor: onDateSelect ? 'pointer' : 'default' }}>
                                                <text
                                                    x={0} y={0} dy={16}
                                                    textAnchor="end"
                                                    fill="#9ca3af"
                                                    fontSize={10}
                                                    transform={range === 'week' ? 'rotate(-30)' : undefined}
                                                >
                                                    {label}
                                                </text>
                                            </g>
                                        );
                                    }}
                                />
                                <YAxis
                                    stroke="#9ca3af"
                                    fontSize={12}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#374151', opacity: 0.4 }} />
                                <Bar
                                    dataKey="value"
                                    fill={theme.stroke}
                                    radius={[4, 4, 0, 0]}
                                    onClick={(barData) => onDateSelect?.(barData.date)}
                                    style={{ cursor: onDateSelect ? 'pointer' : 'default' }}
                                />
                            </BarChart>
                        )}
                    </ResponsiveContainer>
                ) : error ? (
                    <div className="h-full flex flex-col items-center justify-center text-red-400">
                        <p className="font-medium">Failed to load</p>
                        <p className="text-xs mt-1 opacity-70">{error.message}</p>
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-500">
                        <p>No data available.</p>
                        {range === 'day' && metricType === 'steps' && <p className="text-xs mt-2 opacity-60">(Intraday data may require specific permissions)</p>}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ActivityChart;
