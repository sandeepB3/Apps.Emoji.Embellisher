import { IRead, IHttp, IModify, IPersistence } from "@rocket.chat/apps-engine/definition/accessors";
import { IUIKitResponse, UIKitViewSubmitInteractionContext } from "@rocket.chat/apps-engine/definition/uikit";
import { EmbellisherApp } from "../EmbellisherApp";
import { sendMessage } from "../messages/sendMessage";
import { sendNotification } from "../messages/sendNotification";
import { inference } from "./InferenceHandler";
import { getResponse, setResponse } from "../persistence/PromptPersistence";
import { getInteractionRoomData } from "../persistence/RoomPersistence";
import { IRoom } from "@rocket.chat/apps-engine/definition/rooms";
import { initiatorMessage } from "../messages/initiatorMessage";
import { setEmoji } from "../persistence/EmojiPersistence";

export class ExecuteViewSubmitHandler {

    constructor(
        private readonly app: EmbellisherApp,
        private readonly read: IRead,
        private readonly http: IHttp,
        private readonly persistence: IPersistence,
        private readonly modify: IModify,
    ) { }

    public async run(
        context: UIKitViewSubmitInteractionContext
    ): Promise<IUIKitResponse> {

        const data = context.getInteractionData();

        try {
            const { user, view } = data

            switch(view.id) {

                case 'frwd-modal': {
                    const { roomId } = await getInteractionRoomData(this.read.getPersistenceReader(), user.id);
                    if(roomId) {
                        const room = await this.read.getRoomReader().getById(roomId) as IRoom;
                        const roomName = view.state?.["room-block"]?.["room"] as string;
                        const roomToSend = await this.read.getRoomReader().getByName(roomName) as IRoom;

                        if(roomToSend == undefined) {
                            await sendNotification(user, room, this.modify, this.read, `${roomName} - Invalid Room! Check if the room exists.`, ':warning:');
                        }

                        const text = await getResponse(user, this.read.getPersistenceReader());

                        if((typeof(text) == undefined || text.length == 0)) {
                            await sendNotification(user, roomToSend, this.modify, this.read, 'Invalid Input!');
                        } else {
                            await sendMessage(text, user, roomToSend, this.modify);
                            await sendNotification(user, room, this.modify, this.read, 'Message forwarded successfully!', ':white_check_mark:');
                        }
                    }
                    break;
                }

                case 'edit-modal': {
                    const { roomId } = await getInteractionRoomData(this.read.getPersistenceReader(), user.id);
                    if(roomId) {
                        let room = await this.read.getRoomReader().getById(roomId) as IRoom;
                        const text = view.state?.["edit-block"]?.["editor"] as string;

                        if(typeof(text) == undefined || text.length == 0) {
                            await sendNotification(user, room, this.modify, this.read, 'Invalid Input!');
                        } else {
                            await sendMessage(text, user, room, this.modify)
                        }

                    }
                    break;
                }

                case 'redo-modal': {
                    const { roomId } = await getInteractionRoomData(this.read.getPersistenceReader(), user.id);
                    if(roomId) {
                        let room = await this.read.getRoomReader().getById(roomId) as IRoom;

                        const emojify = view.state?.["emoji-block"]?.["emojify"] as string;
                        const emojifyNum: number = parseInt(emojify, 10);
                        const instruct = view.state?.["instruct-block"]?.["instructions"] as string;

                        const new_response = await inference(
                            this.app, user, room, this.modify, this.read, this.http, instruct, true, emojifyNum
                        );

                        if(typeof(new_response) == undefined || new_response.length == 0) {
                            await sendNotification(user, room, this.modify, this.read, 'AI could not regenerate. Please try again!');

                        } else {
                            await setResponse(user, this.persistence, new_response);
                            await setEmoji(user, this.persistence, emojify);

                            const data = {
                                user_text: instruct && instruct.trim() !== "" ? instruct : `Emojify text: ${emojifyNum}%`,
                                response: new_response
                            };

                            await sendNotification(user, room, this.modify, this.read, data.response);
                            await initiatorMessage(user, room, this.modify, data);
                        }
                    }
                    break;
                }

                default: {
                    console.log("Invalid viewId");
                    break;
                }
            }
            return context.getInteractionResponder().successResponse();

        } catch(err) {
            console.log(err);
            return context.getInteractionResponder().errorResponse();
        }

    }
}
