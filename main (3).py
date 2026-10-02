import os
import secrets

from langchain.chat_models import init_chat_model
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)


model = init_chat_model(
    model='llama3.2:1b',
    model_provider="ollama"
)


def to_model_messages(messages):
    """Convert API or template history into LangChain chat messages."""
    role_types = {
        "user": HumanMessage,
        "human": HumanMessage,
        "assistant": AIMessage,
        "ai": AIMessage,
        "system": SystemMessage,
    }
    converted = []
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise ValueError("Each message must have a string content field.")
        message_type = message.get("role", message.get("type"))
        message_class = role_types.get(message_type)
        if message_class is None:
            raise ValueError("Message role must be user, assistant, or system.")
        converted.append(message_class(content=message["content"]))
    return converted


@app.route("/", methods=["GET"])
def home():
    return render_template("chat.html", messages=session.get("messages", []))


@app.route("/send", methods=["POST"])
def send():
    user_input = request.form.get("message", "").strip()
    if user_input:
        messages = session.get("messages", [])
        messages.append({"type": "human", "content": user_input})
        try:
            response = model.invoke(to_model_messages(messages))
            messages.append({"type": "ai", "content": str(response.content)})
        except Exception:
            app.logger.exception("Failed to generate a chat response")
            messages.append({
                "type": "ai",
                "content": "I couldn't reach the model. Check that Ollama is running and try again.",
            })
        session["messages"] = messages
    return redirect(url_for("home"))


@app.route("/clear", methods=["GET", "POST"])
def clear():
    session.pop("messages", None)
    return redirect(url_for("home"))


@app.route("/chat", methods=['POST'])
def chat():
    data = request.get_json(silent=True) or {}
    messages = data.get("messages")
    if not isinstance(messages, list):
        return jsonify({"error": "Request JSON must include a messages list."}), 400
    try:
        response = model.invoke(to_model_messages(messages))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify(
        {"message": {"role": "assistant",
                     "content": response.content}}
    )



if __name__ == "__main__":
    app.run(debug=True, port=5002)
