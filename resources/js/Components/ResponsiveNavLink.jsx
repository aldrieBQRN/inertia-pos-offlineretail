import { Link } from '@inertiajs/react';

export default function ResponsiveNavLink({
    active = false,
    className = '',
    icon = null,
    children,
    method = 'get',
    ...props
}) {
    return (
        <Link
            method={method}
            {...props}
            className={`flex w-full items-center gap-3 py-2.5 px-3.5 rounded-none transition-all duration-200 ${
                active
                    ? 'bg-indigo-50 text-indigo-600 font-bold'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
            } text-sm font-semibold uppercase tracking-wider focus:outline-none active:scale-95 ${className}`}
        >
            {icon && <div className="shrink-0 w-5 h-5 text-current">{icon}</div>}
            <span>{children}</span>
        </Link>
    );
}
