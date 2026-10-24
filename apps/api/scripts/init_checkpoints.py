from langgraph.checkpoint.postgres import PostgresSaver

from app.core.config import settings

if __name__ == "__main__":
    with PostgresSaver.from_conn_string(
        settings().database_url.replace("postgresql+psycopg://", "postgresql://")
    ) as saver:
        saver.setup()
    print("Durable graph checkpoint tables initialized.")
