import { IModify, IHttp, IRead } from '@rocket.chat/apps-engine/definition/accessors';
import { sendNotification } from '../messages/sendNotification';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { SystemPrompt } from '../config/SystemPrompt';
import { getResponse } from '../persistence/PromptPersistence';
import { getEmoji } from '../persistence/EmojiPersistence';

export async function inference(
    app: App,
    user: IUser,
    room: IRoom,
    modify: IModify,
    read: IRead,
    http: IHttp,
    text: string,
    redo: boolean = false,
    emojify: number = 50,
    temperature: number = 0.3,
): Promise<string> {

    const model_ver = await app.getAccessors().environmentReader.getSettings().getValueById('model');
    let model = model_ver.split('-')[0];
    let url = `http://${model_ver}/v1`;
    let headers = {
        "Content-Type": "application/json",
        "Authorization": ""
    };

    const model_name = await app.getAccessors().environmentReader.getSettings().getValueById('model-name');
    const model_url = await app.getAccessors().environmentReader.getSettings().getValueById('model-url');
    const model_key = await app.getAccessors().environmentReader.getSettings().getValueById('model-key');

    if(model_name && model_url && model_key){
        model = model_name;
        url = model_url;
        headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${model_key}`
        }
    }

    const delimiter = "<>"
    const instructs = "--"
    const prev = await getResponse(user, read.getPersistenceReader());
    const prevEmoji = await getEmoji(user, read.getPersistenceReader());

    const promptConfig = new SystemPrompt(
        redo,
        emojify,
        delimiter,
        instructs,
        prev,
        prevEmoji,
    );

    let system_message = "";
    const use_case = await app.getAccessors().environmentReader.getSettings().getValueById('usecase');

    if(use_case == 'event-promotions') {
        system_message = await promptConfig.eventPromotions();
    } else if(use_case == 'customer-support') {
        system_message = await promptConfig.customerSupport();
    } else if(use_case == 'healthcare-support') {
        system_message = await promptConfig.healthcareSupport();
    } else {
        system_message = await promptConfig.communication();
    }

    let prompt = `${delimiter} ${text} ${delimiter}`
    if(redo) {
        prompt = text?.length ? `${instructs} ${text} ${instructs}` : `Emojify text: ${emojify}%`;
    }

    const body = {
        model,
        messages: [
            { role: "system", content: system_message},
            { role: "user", content: prompt},
        ],
        temperature: temperature,
    };

    const response = await http.post(url + "/chat/completions", { headers, content: JSON.stringify(body) });

    if (!response.content) {
        await sendNotification(user, room, modify, read, "Something is wrong with AI. Please try again later");
        throw new Error("Something is wrong with AI. Please try again later");
    }

    let result = JSON.parse(response.content).choices[0].message.content;
    result = result.replace(/--|<>|<|>/g, '');

    return result
}
