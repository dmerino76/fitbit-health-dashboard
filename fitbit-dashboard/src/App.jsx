import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    Activity, Heart, User, Flame, Footprints, Moon, Droplets,
    Utensils, Scale, Watch, Smartphone, Navigation, Layers,
    Calendar, Zap, Award, Target, Info, ChevronRight, TrendingUp
} from 'lucide-react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip,
    BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';
import ActivityChart from './components/ActivityChart';

function App() {
    const [token, setToken] = useState(null);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tokenParam = params.get('token');

        if (tokenParam) {
            setToken(tokenParam);
            localStorage.setItem('fitbit_token', tokenParam);
            window.history.replaceState({}, document.title, "/dashboard");
        } else {
            const storedToken = localStorage.getItem('fitbit_token');
            if (storedToken) setToken(storedToken);
        }
    }, []);

    useEffect(() => {
        if (token) {
            fetchHealthData(date);
        }
    }, [token, date]);

    const fetchHealthData = async (selectedDate) => {
        setLoading(true);
        try {
            const response = await axios.get(`http://localhost:3000/api/health-data?date=${selectedDate}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setData(response.data);
        } catch (error) {
            console.error("Error fetching data", error);
            if (error.response && error.response.status === 401) {
                handleLogout();
            }
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = () => {
        window.location.href = 'http://localhost:3000/auth/fitbit';
    };

    const handleLogout = () => {
        setToken(null);
        setData(null);
        localStorage.removeItem('fitbit_token');
    };

    const getValue = (path, fallback = "--") => {
        return path !== undefined && path !== null ? path : fallback;
    };

    if (!token) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#050505] text-white">
                <div className="text-center p-12 bg-gray-900/50 backdrop-blur-3xl rounded-[2.5rem] shadow-2xl border border-white/5 max-w-md w-full">
                    <div className="w-20 h-20 bg-cyan-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8 border border-cyan-500/20 shadow-[0_0_50px_-12px_rgba(6,182,212,0.5)]">
                        <Activity className="w-10 h-10 text-cyan-500" />
                    </div>
                    <h1 className="text-4xl font-bold mb-3 tracking-tight">Health Sphere</h1>
                    <p className="text-gray-400 mb-10 text-lg leading-relaxed">Connect your Fitbit to unlock beautiful, actionable insights into your daily health journey.</p>
                    <button
                        onClick={handleLogin}
                        className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-lg hover:shadow-cyan-500/20 active:scale-[0.98] flex items-center justify-center gap-3"
                    >
                        Login with Fitbit
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[#050505] text-[#f8fafc] p-4 md:p-8 lg:p-12 font-sans selection:bg-cyan-500/30">
            {/* Header */}
            <header className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center mb-16 gap-6">
                <div className="flex items-center gap-4 group">
                    <div className="w-12 h-12 bg-cyan-500/20 rounded-2xl flex items-center justify-center border border-cyan-500/30 group-hover:rotate-12 transition-transform duration-500">
                        <Activity className="w-7 h-7 text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-black tracking-tighter uppercase">Health<span className="text-cyan-500">Sphere</span></h1>
                        <p className="text-[10px] text-gray-500 uppercase tracking-[0.2em] font-bold">Fitbit Analytics Engine</p>
                    </div>
                </div>

                <div className="flex items-center gap-4 bg-gray-900/40 p-1.5 rounded-[1.5rem] border border-white/5 backdrop-blur-xl">
                    <div className="flex items-center gap-2 bg-black/40 py-2.5 px-5 rounded-2xl border border-white/5">
                        <Calendar className="w-4 h-4 text-gray-500" />
                        <input
                            type="date"
                            value={date}
                            onChange={(e) => setDate(e.target.value)}
                            className="bg-transparent text-xs font-bold text-gray-300 outline-none cursor-pointer uppercase tracking-wider [&::-webkit-calendar-picker-indicator]:invert"
                        />
                    </div>

                    <div className="flex items-center gap-3 pr-4 pl-1">
                        <div className="relative group">
                            <div className="absolute -inset-1 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
                            <img
                                src={data?.profile?.avatar || "https://ui-avatars.com/api/?name=User&background=0D8ABC&color=fff"}
                                alt="Avatar"
                                className="relative w-10 h-10 rounded-full border-2 border-white/10 ring-4 ring-black/20"
                            />
                        </div>
                        <div className="hidden sm:block">
                            <p className="text-xs font-black uppercase text-gray-200">{data?.profile?.fullName || "Astra User"}</p>
                            <p className="text-[9px] text-cyan-500/70 font-bold uppercase tracking-widest">{data?.profile?.memberSince ? `Member since ${data.profile.memberSince.split('-')[0]}` : "Syncing..."}</p>
                        </div>
                        <button onClick={handleLogout} className="ml-4 p-2 text-gray-500 hover:text-rose-500 transition-colors">
                            <Zap className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-[1400px] mx-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-60 gap-4">
                        <div className="relative">
                            <div className="w-20 h-20 rounded-full border-2 border-cyan-500/10 border-t-cyan-500 animate-spin"></div>
                            <Activity className="absolute inset-0 m-auto w-8 h-8 text-cyan-500 animate-pulse" />
                        </div>
                        <p className="text-sm font-black text-gray-500 uppercase tracking-[0.3em]">Decoding Vitals</p>
                    </div>
                ) : data ? (
                    <div className="space-y-16 animate-in fade-in slide-in-from-bottom-4 duration-700">

                        {/* Summary & Goals Section */}
                        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                            {/* Goals Column */}
                            <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                                <GoalCard
                                    title="Steps"
                                    current={data.activity?.summary?.steps || 0}
                                    goal={data.activity?.goals?.steps || 10000}
                                    icon={<Footprints className="w-5 h-5" />}
                                    color="#06b6d4"
                                />
                                <GoalCard
                                    title="Distance"
                                    current={data.activity?.summary?.distances?.[0]?.distance || 0}
                                    goal={data.activity?.goals?.distance || 8}
                                    unit="km"
                                    icon={<Navigation className="w-5 h-5" />}
                                    color="#3b82f6"
                                />
                                <GoalCard
                                    title="Active Zone"
                                    current={data.activity?.summary?.activeZoneMinutes?.totalMinutes || 0}
                                    goal={data.activity?.goals?.activeZoneMinutes || 30}
                                    icon={<Award className="w-5 h-5" />}
                                    color="#f59e0b"
                                    unit="mins"
                                />
                                <GoalCard
                                    title="Calories"
                                    current={data.activity?.summary?.caloriesOut || 0}
                                    goal={data.activity?.goals?.caloriesOut || 2500}
                                    icon={<Flame className="w-5 h-5" />}
                                    color="#f43f5e"
                                />
                            </div>

                            {/* Activity Breakdown Column */}
                            <div className="lg:col-span-4 bg-gray-900/30 rounded-[2.5rem] border border-white/5 p-8 flex flex-col h-full backdrop-blur-md">
                                <h3 className="text-sm font-black uppercase text-gray-500 tracking-[0.2em] mb-8 flex items-center gap-2">
                                    <Target className="w-4 h-4 text-cyan-500" />
                                    Daily Intensity
                                </h3>
                                <div className="flex-1 flex flex-col items-center justify-center">
                                    <div className="w-full h-48">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={[
                                                        { name: 'Sedentary', value: data.activity?.summary?.sedentaryMinutes || 1 },
                                                        { name: 'Lightly Active', value: data.activity?.summary?.lightlyActiveMinutes || 0 },
                                                        { name: 'Fairly Active', value: data.activity?.summary?.fairlyActiveMinutes || 0 },
                                                        { name: 'Very Active', value: data.activity?.summary?.veryActiveMinutes || 0 },
                                                    ]}
                                                    innerRadius={60}
                                                    outerRadius={80}
                                                    paddingAngle={8}
                                                    dataKey="value"
                                                >
                                                    <Cell fill="#1e293b" />
                                                    <Cell fill="#06b6d4" />
                                                    <Cell fill="#3b82f6" />
                                                    <Cell fill="#8b5cf6" />
                                                </Pie>
                                                <ReTooltip
                                                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)', fontSize: '10px', fontWeight: 'bold' }}
                                                />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="w-full grid grid-cols-2 gap-4 mt-8">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-cyan-500"></div>
                                            <span className="text-[10px] font-black uppercase text-gray-400">Light</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                            <span className="text-[10px] font-black uppercase text-gray-400">Moderate</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-violet-600"></div>
                                            <span className="text-[10px] font-black uppercase text-gray-400">Intense</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-slate-800"></div>
                                            <span className="text-[10px] font-black uppercase text-gray-400">Still</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Vital Histories Section */}
                        <section>
                            <div className="flex items-center gap-4 mb-10 overflow-x-auto pb-4 scrollbar-hide">
                                <SectionHeader icon={<TrendingUp className="w-5 h-5" />} title="Performance Trends" />
                            </div>
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                                <ActivityChart
                                    token={token}
                                    date={date}
                                    title="Movement (Steps)"
                                    metricType="steps"
                                    unit="steps"
                                    color="cyan"
                                    icon={Footprints}
                                />
                                <ActivityChart
                                    token={token}
                                    date={date}
                                    title="Resting Heart Rate"
                                    metricType="heart"
                                    unit="bpm"
                                    color="rose"
                                    icon={Heart}
                                />
                                <ActivityChart
                                    token={token}
                                    date={date}
                                    title="Sleep Consistency"
                                    metricType="sleep"
                                    unit="mins"
                                    color="violet"
                                    icon={Moon}
                                />
                                <ActivityChart
                                    token={token}
                                    date={date}
                                    title="Body Mass Index"
                                    metricType="weight"
                                    unit="kg"
                                    color="amber"
                                    icon={Scale}
                                />
                            </div>
                        </section>

                        {/* Detailed Metrics Grid */}
                        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">

                            {/* Heart Rate Zones */}
                            <div className="bg-gray-900/30 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                                <h3 className="text-sm font-black uppercase text-gray-500 tracking-[0.2em] mb-10 flex items-center gap-2">
                                    <Heart className="w-4 h-4 text-rose-500" />
                                    Heart Zones
                                </h3>
                                <div className="space-y-8">
                                    {data.heartRate?.[0]?.value?.heartRateZones?.slice().reverse().map((zone, idx) => (
                                        <div key={idx} className="group cursor-default">
                                            <div className="flex justify-between items-end mb-2">
                                                <div>
                                                    <p className="text-[9px] font-black uppercase text-gray-500 tracking-wider group-hover:text-white transition-colors">{zone.name}</p>
                                                    <p className="text-xl font-black">{zone.minutes}<span className="text-[10px] text-gray-600 font-bold ml-1">MIN</span></p>
                                                </div>
                                                <p className="text-[10px] font-black text-rose-500/60">{zone.min}-{zone.max} <span className="opacity-50">BPM</span></p>
                                            </div>
                                            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full bg-gradient-to-r ${idx === 0 ? 'from-rose-600 to-red-600' : idx === 1 ? 'from-orange-500 to-rose-500' : 'from-yellow-400 to-orange-400'}`}
                                                    style={{ width: `${Math.min(100, (zone.minutes / 180) * 100)}%` }}
                                                ></div>
                                            </div>
                                        </div>
                                    ))}
                                    {(!data.heartRate?.[0]?.value?.heartRateZones) && <p className="text-xs text-gray-600 italic">Zones data unavailable for this date.</p>}
                                </div>
                            </div>

                            {/* Sleep Stages */}
                            <div className="bg-gray-900/30 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                                <h3 className="text-sm font-black uppercase text-gray-500 tracking-[0.2em] mb-10 flex items-center gap-2">
                                    <Moon className="w-4 h-4 text-violet-500" />
                                    Sleep Architecture
                                </h3>
                                {data.sleepSummary?.stages ? (
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
                                            <div>
                                                <p className="text-[9px] font-black text-violet-500/70 uppercase">Total Capacity</p>
                                                <p className="text-2xl font-black">{(data.sleepSummary.totalMinutesAsleep / 60).toFixed(1)}<span className="text-xs font-bold text-gray-600 ml-1">HRS</span></p>
                                            </div>
                                            <Award className="w-8 h-8 text-violet-500/20" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <StageBox label="Deep" value={data.sleepSummary.stages.deep} color="bg-violet-700" />
                                            <StageBox label="REM" value={data.sleepSummary.stages.rem} color="bg-violet-500" />
                                            <StageBox label="Light" value={data.sleepSummary.stages.light} color="bg-violet-300" />
                                            <StageBox label="Awake" value={data.sleepSummary.stages.wake} color="bg-gray-700" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 gap-4 opacity-40">
                                        <Info className="w-8 h-8" />
                                        <p className="text-[10px] font-black uppercase tracking-widest text-center">Summary log detected, but stage architecture is missing for this sleep record.</p>
                                    </div>
                                )}
                            </div>

                            {/* Nutrition Macros */}
                            <div className="bg-gray-900/30 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md">
                                <h3 className="text-sm font-black uppercase text-gray-500 tracking-[0.2em] mb-10 flex items-center gap-2">
                                    <Utensils className="w-4 h-4 text-emerald-500" />
                                    Macro Ecosystem
                                </h3>
                                <div className="space-y-8">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Hydration Balance</p>
                                            <div className="flex items-center gap-3 mt-1">
                                                <Droplets className="w-6 h-6 text-blue-500" />
                                                <h4 className="text-3xl font-black">{data.nutrition?.water?.summary?.water || 0}<span className="text-xs text-gray-600 ml-1">ML</span></h4>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-4 pt-4 border-t border-white/5">
                                        <MacroLine label="Protein" val={data.nutrition?.food?.summary?.protein || 0} max={150} color="bg-emerald-500" />
                                        <MacroLine label="Carbs" val={data.nutrition?.food?.summary?.carbs || 0} max={300} color="bg-blue-400" />
                                        <MacroLine label="Fats" val={data.nutrition?.food?.summary?.fat || 0} max={80} color="bg-yellow-500" />
                                    </div>

                                    <div className="mt-8 p-6 bg-emerald-500/10 rounded-3xl border border-emerald-500/20">
                                        <p className="text-[9px] font-black uppercase text-emerald-500/70 mb-1">Fuel Intake</p>
                                        <h4 className="text-2xl font-black text-emerald-400">{data.nutrition?.food?.summary?.calories || 0}<span className="text-xs font-bold text-emerald-500/40 ml-1">KCAL LOGGED</span></h4>
                                    </div>
                                </div>
                            </div>
                        </section>

                        {/* Connected Infrastructure */}
                        <section>
                            <SectionHeader icon={<Watch className="w-5 h-5" />} title="Ecosystem Infrastructure" />
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {data.devices?.map((device, index) => (
                                    <DeviceCard key={index} device={device} />
                                ))}
                            </div>
                        </section>
                    </div>
                ) : (
                    <div className="text-center py-40 flex flex-col items-center gap-8">
                        <div className="w-24 h-24 bg-gray-900 rounded-[2rem] flex items-center justify-center border border-white/5 shadow-2xl">
                            <Info className="w-10 h-10 text-gray-700" />
                        </div>
                        <div className="space-y-2">
                            <h2 className="text-2xl font-black uppercase tracking-tight">Signal Interrupted</h2>
                            <p className="text-gray-500 max-w-sm mx-auto">We couldn't establish a secure connection with your vitals. Please re-authenticate to restore the data bridge.</p>
                        </div>
                        <button
                            onClick={handleLogin}
                            className="bg-white text-black font-black px-10 py-4 rounded-2xl hover:bg-gray-200 transition-all flex items-center gap-2"
                        >
                            Reconnect Node <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
            </main>

            <footer className="max-w-[1400px] mx-auto mt-24 pt-12 border-t border-white/5 flex flex-col sm:flex-row justify-between items-center gap-8 opacity-40">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-white/10 rounded-lg flex items-center justify-center">
                        <Activity className="w-3 h-3" />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-[0.3em]">Astra Health OS v2.4</span>
                </div>
                <p className="text-[9px] font-black uppercase tracking-widest text-center">Encryption Active • Secure Link Verified • Live Fitbit Data</p>
                <div className="flex items-center gap-6">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                    <span className="text-[9px] font-black uppercase tracking-widest">System Operational</span>
                </div>
            </footer>
        </div>
    );
}

// Sub-components for better organization
function SectionHeader({ icon, title }) {
    return (
        <div className="flex items-center gap-4 group">
            <div className="p-3 bg-gray-900/50 rounded-2xl border border-white/10 group-hover:scale-110 transition-transform duration-500">
                {icon}
            </div>
            <h2 className="text-xl font-black uppercase tracking-[0.2em] text-white/90">{title}</h2>
        </div>
    );
}

function GoalCard({ title, current, goal, icon, color, unit = "" }) {
    const progress = Math.min(100, Math.max(0, (current / goal) * 100));
    return (
        <div className="bg-gray-900/30 rounded-[2.5rem] border border-white/5 p-8 backdrop-blur-md group hover:bg-gray-900/50 transition-all duration-500 overflow-hidden relative">
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 blur-[80px] opacity-[0.03] transition-opacity group-hover:opacity-[0.08]" style={{ backgroundColor: color }}></div>

            <div className="flex justify-between items-start relative z-10 mb-8">
                <div className="p-3 bg-white/5 rounded-2xl border border-white/5 text-gray-400 group-hover:text-white transition-colors" style={{ color: current >= goal ? color : undefined }}>
                    {icon}
                </div>
                <div className="text-right">
                    <p className="text-[10px] font-black uppercase text-gray-500 tracking-[0.2em]">{title}</p>
                    <h4 className="text-2xl font-black mt-1">
                        {current.toLocaleString()}
                        {unit && <span className="text-[10px] text-gray-600 ml-1 font-bold">{unit.toUpperCase()}</span>}
                    </h4>
                </div>
            </div>

            <div className="relative h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div
                    className="absolute h-full left-0 top-0 transition-all duration-1000 ease-out rounded-full shadow-[0_0_15px_-2px_rgba(255,255,255,0.2)]"
                    style={{
                        width: `${progress}%`,
                        backgroundColor: color,
                        boxShadow: `0 0 20px -3px ${color}66`
                    }}
                ></div>
            </div>
            <div className="flex justify-between mt-4">
                <p className="text-[9px] font-black text-gray-600 uppercase">Current</p>
                <p className="text-[9px] font-black uppercase" style={{ color: color }}>Target: {goal.toLocaleString()}</p>
            </div>
        </div>
    );
}

function StageBox({ label, value, color }) {
    return (
        <div className="p-4 bg-white/5 rounded-2xl border border-white/5 group hover:bg-white/10 transition-colors">
            <div className="flex items-center gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full ${color}`}></div>
                <span className="text-[9px] font-black uppercase text-gray-500 tracking-widest">{label}</span>
            </div>
            <p className="text-lg font-black">{value || 0}<span className="text-[8px] text-gray-600 font-bold ml-1">MIN</span></p>
        </div>
    );
}

function MacroLine({ label, val, max, color }) {
    return (
        <div className="group">
            <div className="flex justify-between items-center mb-1.5">
                <span className="text-[9px] font-black uppercase text-gray-500 tracking-widest group-hover:text-white transition-colors">{label}</span>
                <span className="text-[10px] font-black">{val}g <span className="text-gray-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">/ {max}g</span></span>
            </div>
            <div className="h-1 w-full bg-white/5 rounded-full">
                <div className={`h-full rounded-full ${color} opacity-60 group-hover:opacity-100 transition-all duration-700`} style={{ width: `${Math.min(100, (val / max) * 100)}%` }}></div>
            </div>
        </div>
    );
}

function DeviceCard({ device }) {
    return (
        <div className="p-8 rounded-[2.5rem] border bg-gray-900/30 border-white/5 flex flex-col gap-6 backdrop-blur-md group hover:bg-gray-900/50 transition-all">
            <div className="flex justify-between items-start">
                <div className="p-4 bg-white/5 rounded-[1.5rem] border border-white/10 group-hover:rotate-6 transition-transform">
                    {device.type === 'TRACKER' ? <Watch className="w-8 h-8 text-cyan-400" /> : <Smartphone className="w-8 h-8 text-gray-400" />}
                </div>
                <div className="bg-white/5 px-4 py-1.5 rounded-full border border-white/5">
                    <p className={`text-[9px] font-black uppercase tracking-widest ${device.battery === 'High' ? 'text-emerald-500' : 'text-amber-500'}`}>Battery: {device.battery}</p>
                </div>
            </div>
            <div>
                <h3 className="font-black text-xl uppercase tracking-wider">{device.deviceVersion}</h3>
                <div className="flex items-center gap-2 mt-2">
                    <div className="w-1 h-1 rounded-full bg-cyan-500 animate-pulse"></div>
                    <p className="text-[9px] text-gray-500 font-black uppercase tracking-widest leading-none">Last Synced: {new Date(device.lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
            </div>
        </div>
    );
}

export default App;

