import { useState, useEffect } from 'react';
import Dropdown from '@/Components/Dropdown';
import NavLink from '@/Components/NavLink';
import ResponsiveNavLink from '@/Components/ResponsiveNavLink';
import { Link, usePage } from '@inertiajs/react';
import usePrinterStore from '@/Stores/usePrinterStore';
import ApplicationLogo from '@/Components/ApplicationLogo';

export default function AuthenticatedLayout({ header, children, navBtn }) {
    const { url } = usePage();
    const { auth, settings } = usePage().props;
    const user = auth.user;

    const [showingNavigationDropdown, setShowingNavigationDropdown] = useState(false);
    const [logoError, setLogoError] = useState(false);

    const autoConnectUsb = usePrinterStore((state) => state.autoConnectUsb);
    const setupUsbListeners = usePrinterStore((state) => state.setupUsbListeners);

    useEffect(() => {
        setupUsbListeners();
        autoConnectUsb();
    }, [url]);

    // App name and logo shown in the top navigation bar
    const appName = settings?.app_name || 'Inertia POS';
    const logoUrl = settings?.logo_path 
        ? (settings.logo_path.startsWith('http') || settings.logo_path.startsWith('/') ? settings.logo_path : `/storage/${settings.logo_path}`) 
        : null;

    // Reset logoError if the logo URL changes (e.g. settings updated)
    useEffect(() => {
        setLogoError(false);
    }, [logoUrl]);

    // Helper for generating dynamic initials avatar
    const getInitials = (name) => {
        if (!name) return 'U';
        const parts = name.trim().split(' ').filter(Boolean);
        if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    };

    // Helper component for Desktop Nav items
    const NavItem = ({ href, active, icon, label }) => {
        return (
            <Link
                href={href}
                className={`group relative flex items-center justify-center h-10 px-3 sm:px-3.5 rounded-none transition-all duration-300 ease-in-out select-none
                    ${active 
                        ? 'bg-indigo-50 text-indigo-600' 
                        : 'text-gray-555 hover:bg-gray-50 hover:text-gray-900'
                    }`}
            >
                <div className={`shrink-0 transition-colors duration-300 ${active ? 'text-indigo-600' : 'text-gray-555 group-hover:text-gray-900'}`}>
                    {icon}
                </div>
                {/* TOOLTIP: Tablet & Desktop (hidden on mobile) */}
                <div className="absolute top-[50px] left-1/2 -translate-x-1/2 hidden sm:group-hover:flex flex-col items-center z-50 pointer-events-none">
                    <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-b-[5px] border-b-gray-800"></div>
                    <span className="bg-gray-800 text-white text-[10px] font-black rounded-none py-1 px-2 shadow-lg whitespace-nowrap uppercase tracking-wider">
                        {label}
                    </span>
                </div>
            </Link>
        );
    };

    const isPosTerminal = url === '/pos';

    return (
        <div className={isPosTerminal ? "h-screen overflow-hidden flex flex-col bg-white" : "min-h-screen bg-gray-100"}>

            {/* Nav remains z-40 so it stays above page content, but below modals (z-50) */}
            <nav className={`border-b bg-white sticky top-0 z-40 ${isPosTerminal ? 'border-gray-100 md:border-b-2 md:border-gray-300' : 'border-gray-100'}`}>
                <div className="w-full px-4 sm:px-6 lg:px-8">
                    <div className="flex h-16 justify-between items-center relative">
                        {/* 1. Left: Brand Wordmark */}
                        <div className="flex shrink-0 items-center z-10">
                            <Link href="/" className="flex items-center group">
                                <ApplicationLogo showSubtitle={true} size="default" />
                            </Link>
                        </div>

                        {/* 2. Center: Centered Navigation Links (Desktop lg+) */}
                        <div className="hidden lg:flex items-center justify-center flex-1 mx-4 lg:space-x-2 xl:space-x-3">
                            <NavItem href={route('dashboard')} active={route().current('dashboard')} label="Dashboard" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>} />
                            <NavItem href={route('pos')} active={route().current('pos')} label="POS Terminal" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>} />
                            <NavItem href={route('reports')} active={route().current('reports')} label="Reports" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>} />
                            <NavItem href={route('inventory.index')} active={route().current('inventory.index')} label="Inventory" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>} />
                            <NavItem href={route('transactions.index')} active={route().current('transactions.index')} label="Transactions" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>} />
                            <NavItem href={route('shifts.index')} active={route().current('shifts.index')} label="Shifts" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>} />
                            <NavItem href={route('activity-logs.index')} active={route().current('activity-logs.*')} label="Activity Logs" icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0112 2.714z" /></svg>} />
                        </div>

                        {/* 3. Right: Account / Profile Trigger (Desktop lg+) */}
                        <div className="hidden lg:flex shrink-0 items-center gap-3 z-10">
                            <div className="relative ms-1">
                                <Dropdown>
                                    <Dropdown.Trigger>
                                        {({ open }) => (
                                            <button
                                                type="button"
                                                className="group flex items-center gap-2.5 px-2 py-1.5 rounded-none bg-transparent hover:bg-gray-100/70 transition-all duration-150 focus:outline-none select-none cursor-pointer"
                                            >
                                                {/* Avatar matching Staff Page */}
                                                {user.avatar_path ? (
                                                    <img
                                                        src={`/storage/${user.avatar_path}`}
                                                        alt={user.name}
                                                        className="w-9 h-9 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-sm border border-gray-200 shrink-0 uppercase shadow-2xs">
                                                        {user.name ? user.name.charAt(0) : 'U'}
                                                    </div>
                                                )}

                                                {/* Clean User Info Stack */}
                                                <div className="hidden xl:flex flex-col text-left min-w-0 pr-0.5">
                                                    <span className="text-xs font-bold text-gray-900 truncate max-w-[140px] leading-tight">
                                                        {user.name}
                                                    </span>
                                                    <span className="text-[10px] font-medium text-gray-400 truncate max-w-[140px] leading-tight mt-0.5">
                                                        {settings?.store_name || 'Store Administrator'}
                                                    </span>
                                                </div>

                                                {/* Chevron Icon with 180° twist animation */}
                                                <svg
                                                    className={`w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 transition-transform duration-200 ease-in-out ${open ? 'rotate-180 text-gray-700' : ''}`}
                                                    xmlns="http://www.w3.org/2000/svg"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                >
                                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </button>
                                        )}
                                    </Dropdown.Trigger>

                                    <Dropdown.Content width="64" contentClasses="p-0 bg-white shadow-xl rounded-none border border-gray-100 divide-y divide-gray-100 overflow-hidden">
                                        {/* 1. Header Profile Info */}
                                        <div className="p-3.5 bg-gray-50/60">
                                            <div className="flex items-center gap-2.5">
                                                {user.avatar_path ? (
                                                    <img
                                                        src={`/storage/${user.avatar_path}`}
                                                        alt={user.name}
                                                        className="w-10 h-10 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-sm border border-gray-200 shrink-0 uppercase shadow-2xs">
                                                        {user.name ? user.name.charAt(0) : 'U'}
                                                    </div>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <h4 className="text-xs font-bold text-gray-900 truncate leading-tight">{user.name}</h4>
                                                    <p className="text-[11px] text-gray-500 truncate font-normal leading-tight mt-0.5">Store Administrator</p>
                                                </div>
                                            </div>

                                        </div>

                                        {/* 2. Management Shortcuts Section */}
                                        <div className="py-2 px-1.5 space-y-0.5">
                                            <div className="px-3 py-1 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                                Account & Preferences
                                            </div>

                                            {/* My Profile */}
                                            <Link
                                                href={route('profile.edit')}
                                                className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 rounded-none transition-all group"
                                            >
                                                <div className="w-8 h-8 rounded-none bg-gray-100 text-gray-600 flex items-center justify-center group-hover:bg-gray-900 group-hover:text-white transition-colors shrink-0">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                                                    </svg>
                                                </div>
                                                <div className="flex flex-col min-w-0 text-left">
                                                    <span className="font-bold text-gray-900">My Profile</span>
                                                    <span className="text-[10px] text-gray-400 font-normal">Security & authentication</span>
                                                </div>
                                            </Link>

                                            {/* Store Settings */}
                                            <Link
                                                href={route('settings')}
                                                className="flex items-center gap-3 px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-100/80 rounded-none transition-all group"
                                            >
                                                <div className="w-8 h-8 rounded-none bg-blue-50 text-[#1B3B6A] flex items-center justify-center group-hover:bg-[#1B3B6A] group-hover:text-white transition-colors shrink-0">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="1.75" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.041.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.005-.828a1.125 1.125 0 01-.26-1.43l1.298-2.247a1.125 1.125 0 011.369-.491l1.217.456c.356.133.751.072 1.076-.124.072-.044.145-.086.22-.128.332-.183.582-.495.644-.869l.213-1.281z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                    </svg>
                                                </div>
                                                <div className="flex flex-col min-w-0 text-left">
                                                    <span className="font-bold text-gray-900">Store Settings</span>
                                                    <span className="text-[10px] text-gray-400 font-normal">Store profile, receipts & hardware</span>
                                                </div>
                                            </Link>
                                        </div>

                                        {/* 3. Sign Out Footer */}
                                        <div className="p-2 bg-gray-50/80">
                                            <Link
                                                href={route('logout')}
                                                method="post"
                                                as="button"
                                                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-red-600 hover:text-red-700 hover:bg-red-50/80 rounded-none transition-all"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                                                </svg>
                                                Sign Out
                                            </Link>
                                        </div>
                                    </Dropdown.Content>
                                </Dropdown>
                            </div>
                        </div>

                        {/* Hamburger Button (shown on tablet portrait & mobile < lg) */}
                        <div className="-me-2 flex items-center gap-2 lg:hidden">
                            {/* Mobile Header User Avatar */}
                            <button
                                onClick={() => setShowingNavigationDropdown(true)}
                                className="flex items-center p-0.5 rounded-none hover:bg-gray-100 transition-colors focus:outline-none cursor-pointer"
                                title="Open Menu"
                            >
                                {user.avatar_path ? (
                                    <img
                                        src={`/storage/${user.avatar_path}`}
                                        alt={user.name}
                                        className="w-8 h-8 rounded-none object-cover border border-gray-200 shadow-2xs"
                                    />
                                ) : (
                                    <div className="w-8 h-8 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-xs border border-gray-200 uppercase shadow-2xs">
                                        {user.name ? user.name.charAt(0) : 'U'}
                                    </div>
                                )}
                            </button>

                            <button
                                onClick={() => setShowingNavigationDropdown(true)}
                                className="inline-flex items-center justify-center rounded-none p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors focus:outline-none cursor-pointer"
                            >
                                <svg className="h-6 w-6" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            {/* MOBILE NAVIGATION DRAWER (active on < lg) */}
            <div className={`fixed inset-0 z-[60] lg:hidden transition-all duration-300 ${showingNavigationDropdown ? 'visible' : 'invisible'}`}>
                <div className={`fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${showingNavigationDropdown ? 'opacity-100' : 'opacity-0'}`} onClick={() => setShowingNavigationDropdown(false)} />
                <div className={`fixed inset-y-0 left-0 w-72 bg-white shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${showingNavigationDropdown ? 'translate-x-0' : '-translate-x-full'}`}>
                    
                    {/* Top Profile Card in Mobile Drawer */}
                    <div className="p-4 bg-gradient-to-b from-gray-50/90 to-white border-b border-gray-100">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                {user.avatar_path ? (
                                    <img
                                        src={`/storage/${user.avatar_path}`}
                                        alt={user.name}
                                        className="w-10 h-10 rounded-none object-cover border border-gray-200 shadow-2xs shrink-0"
                                    />
                                ) : (
                                    <div className="w-10 h-10 rounded-none bg-gradient-to-br from-slate-100 to-[#EFF4F9] text-[#1B3B6A] flex items-center justify-center font-black text-sm border border-gray-200 shrink-0 uppercase shadow-2xs">
                                        {user.name ? user.name.charAt(0) : 'U'}
                                    </div>
                                )}
                                <div className="min-w-0 flex-1">
                                    <h4 className="text-xs font-bold text-gray-900 truncate leading-tight">{user.name}</h4>
                                    <p className="text-[10px] font-medium text-gray-400 truncate leading-tight mt-0.5">
                                        {settings?.store_name || 'Store Administrator'}
                                    </p>
                                </div>
                            </div>

                            {/* Close Button */}
                            <button
                                onClick={() => setShowingNavigationDropdown(false)}
                                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-none transition-colors cursor-pointer shrink-0"
                            >
                                <svg className="h-5 w-5" stroke="currentColor" fill="none" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-2">
                        <ResponsiveNavLink href={route('dashboard')} active={route().current('dashboard')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" /></svg>}>Dashboard</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('pos')} active={route().current('pos')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" /></svg>}>POS Terminal</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('reports')} active={route().current('reports')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>}>Reports</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('inventory.index')} active={route().current('inventory.index')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>}>Inventory</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('transactions.index')} active={route().current('transactions.index')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>}>Transactions</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('shifts.index')} active={route().current('shifts.index')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}>Shifts</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('activity-logs.index')} active={route().current('activity-logs.*')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751A11.959 11.959 0 0112 2.714z" /></svg>}>Activity Logs</ResponsiveNavLink>

                        <div className="border-t border-gray-100 my-4"></div>
                        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-3 mb-1">My Account</div>
                        <ResponsiveNavLink href={route('profile.edit')} active={route().current('profile.edit')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>}>My Profile</ResponsiveNavLink>
                        <ResponsiveNavLink href={route('settings')} active={route().current('settings')} icon={<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.592c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.041.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.005-.828a1.125 1.125 0 01-.26-1.43l1.298-2.247a1.125 1.125 0 011.369-.491l1.217.456c.356.133.751.072 1.076-.124.072-.044.145-.086.22-.128.332-.183.582-.495.644-.869l.213-1.281z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}>Store Settings</ResponsiveNavLink>
                    </div>
                    <div className="p-4 bg-gray-50 border-t border-gray-100 mt-auto">
                        <ResponsiveNavLink method="post" href={route('logout')} as="button" className="w-full text-center text-red-600 font-bold">Sign Out</ResponsiveNavLink>
                    </div>
                </div>
            </div>

            {/* REMOVED: relative z-20. The header will now sit behind fixed modals correctly. */}
            {header && (
                <header className="bg-white shadow-sm border-b border-gray-100">
                    <div className="w-full px-4 py-6 sm:px-6 lg:px-8">{header}</div>
                </header>
            )}

            {/* REMOVED: relative z-0. Main content will now allow modals to escape. */}
            <main className={`animate-in fade-in duration-500 ${isPosTerminal ? 'flex-1 h-0 overflow-hidden bg-white' : ''}`}>{children}</main>
        </div>
    );
}