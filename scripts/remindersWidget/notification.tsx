import { Notification, Link } from 'scripting'

function HydrationUI() {
    return (
        <Link url={`x-apple-reminderkit://REMCDReminder/`}
            font={20}
            bold={true}
            foregroundStyle="#FFFFFFFF"
            widgetAccentable
        >
            {`提醒事项`}
        </Link>
    )
}

Notification.present(<HydrationUI />)
