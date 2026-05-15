'use client';
import TelegramChat from "@/components/TelegramChat";

export default function RecentChatsPage() {
    return (
        <div className="flex justify-center items-center h-screen bg-stone-50">
            <div className="w-[500px] h-screen">
                <TelegramChat
                    contact={{ id: "Hello", firstName: "Hello", lastName: "World", username: "helloworld" }}
                    messages={[]}
                    onSendMessage={() => { }}
                    isLoading={false}
                />
            </div>
        </div>
    );
}